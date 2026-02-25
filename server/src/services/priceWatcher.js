/**
 * PriceWatcher — persistent WebSocket ticker streams for alert evaluation.
 *
 * Maintains always-on WS connections to each exchange that has active alerts.
 * Prices are updated in-memory every ~1 second (exchange push), so the alert
 * engine never needs REST calls — just an instant Map lookup.
 *
 * Supported exchanges:
 *   Binance  – !miniTicker@arr (single WS → ALL tickers, ~1 s updates)
 *   Bybit    – tickers.{SYMBOL} (per-symbol subscription on one WS)
 *   OKX      – tickers channel with instType SWAP/SPOT (all tickers)
 *   Gate     – futures.tickers / spot.tickers with !all wildcard
 *   Bitget   – ticker channel (per-symbol subscription)
 *   MEXC     – REST polling fallback (their WS is unreliable)
 */

const WebSocket = require('ws');

// ─── Configuration ──────────────────────────────────────────────────────────
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
const PING_INTERVAL_MS = 20000;
const STALE_THRESHOLD_MS = 30000; // map considered stale after 30 s without update
const REST_POLL_INTERVAL_MS = 3000; // for MEXC REST polling
const SUBSCRIPTION_REFRESH_MS = 60000; // how often to reconcile subscriptions with active alerts

// ─── In-memory price store ──────────────────────────────────────────────────
// Structure: prices[exchange][market] = { BTCUSDT: 97000, ETHUSDT: 3200, ... }
const prices = {
  binance:  { futures: {}, spot: {} },
  bybit:    { futures: {}, spot: {} },
  okx:      { futures: {}, spot: {} },
  gate:     { futures: {}, spot: {} },
  bitget:   { futures: {}, spot: {} },
  mexc:     { futures: {}, spot: {} },
};

// Last update timestamps per exchange+market
const lastUpdated = {
  binance:  { futures: 0, spot: 0 },
  bybit:    { futures: 0, spot: 0 },
  okx:      { futures: 0, spot: 0 },
  gate:     { futures: 0, spot: 0 },
  bitget:   { futures: 0, spot: 0 },
  mexc:     { futures: 0, spot: 0 },
};

// Connection state
const connections = new Map(); // key "exchange|market" → { ws, reconnectAttempts, pingTimer, reconnectTimer }
let running = false;
let refreshTimer = null;
let mexcFuturesPollTimer = null;
let mexcSpotPollTimer = null;

// Symbols that need monitoring (set by refreshSubscriptions)
const watchedSymbols = {
  bybit:  { futures: new Set(), spot: new Set() },
  bitget: { futures: new Set(), spot: new Set() },
};

// ─── Tick listeners (event-driven price push) ───────────────────────────────
// Listeners receive { exchange, market, prices: { SYMBOL: price, ... } } on
// every WS batch / REST poll — no sampling loss, no polling delay.
const tickListeners = new Set();

function onTick(fn) { if (typeof fn === 'function') tickListeners.add(fn); }
function offTick(fn) { tickListeners.delete(fn); }

function emitTick(exchange, market, tickPrices) {
  if (tickListeners.size === 0) return;
  const event = { exchange, market, prices: tickPrices };
  for (const fn of tickListeners) {
    try { fn(event); } catch { /* listener error must not crash WS handler */ }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the full price map for an exchange+market.
 * Returns { BTCUSDT: 97000, ... } or {} if no data.
 */
function getPriceMap(exchange, market) {
  const ex = String(exchange || '').toLowerCase();
  const mkt = String(market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  return prices[ex]?.[mkt] || {};
}

/**
 * Check if the price map for exchange+market is fresh (updated within threshold).
 */
function isFresh(exchange, market) {
  const ex = String(exchange || '').toLowerCase();
  const mkt = String(market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const ts = lastUpdated[ex]?.[mkt] || 0;
  return ts > 0 && (Date.now() - ts) < STALE_THRESHOLD_MS;
}

/**
 * Start all watchers.  Called once at server boot.
 */
async function start() {
  if (running) return;
  running = true;
  console.log('[PriceWatcher] Starting...');

  // Do first subscription refresh immediately
  await refreshSubscriptions();

  // Periodic refresh to add/remove connections as alerts change
  refreshTimer = setInterval(() => {
    refreshSubscriptions().catch(err =>
      console.error('[PriceWatcher] refreshSubscriptions error:', err.message)
    );
  }, SUBSCRIPTION_REFRESH_MS);

  console.log('[PriceWatcher] Started');
}

/**
 * Stop all watchers.  Called on graceful shutdown.
 */
function stop() {
  running = false;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (mexcFuturesPollTimer) { clearInterval(mexcFuturesPollTimer); mexcFuturesPollTimer = null; }
  if (mexcSpotPollTimer) { clearInterval(mexcSpotPollTimer); mexcSpotPollTimer = null; }

  for (const [key, conn] of connections.entries()) {
    closeConnection(key, conn, 'shutdown');
  }
  connections.clear();
  console.log('[PriceWatcher] Stopped');
}

// ─── Subscription management ────────────────────────────────────────────────

/**
 * Query DB for active price alerts AND complex alerts, then ensure WS
 * connections exist for each unique exchange+market that has alerts.
 * Disconnect from exchange+market combos that no longer have alerts.
 *
 * Complex alerts (alertType='complex') stay active even after triggering,
 * so we include them via a separate OR branch.
 */
async function refreshSubscriptions() {
  if (!running) return;

  const prisma = require('../utils/prisma');
  let alerts;
  try {
    alerts = await prisma.alert.findMany({
      where: {
        isActive: true,
        OR: [
          // Price alerts: must not be triggered (they self-delete)
          { triggered: false, alertType: 'price' },
          // Complex alerts: keep monitoring even after triggered
          { alertType: 'complex' },
        ],
      },
      select: { exchange: true, market: true, symbols: true, alertType: true, notificationOptions: true },
    });
  } catch (err) {
    console.error('[PriceWatcher] DB query failed:', err.message);
    return;
  }

  // Collect needed exchange+market pairs, and per-symbol sets for Bybit/Bitget
  const needed = new Set();
  const bybitFuturesSyms = new Set();
  const bybitSpotSyms = new Set();
  const bitgetFuturesSyms = new Set();
  const bitgetSpotSyms = new Set();

  for (const alert of alerts) {
    const ex = String(alert.exchange || 'binance').toLowerCase();
    const mkt = String(alert.market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
    needed.add(`${ex}|${mkt}`);

    // For per-symbol exchanges, track needed symbols
    if (ex === 'bybit' || ex === 'bitget') {
      // Complex alerts with alertForMode='all': we need to add the exchange+market pair
      // but for per-symbol WS (Bybit/Bitget) we can't subscribe to ALL symbols via WS.
      // The price feeder in alertEngine will fall back to REST for 'all' mode on these.
      // For whitelist mode, add each symbol to the per-symbol subscription set.
      let notifOpts = {};
      try {
        notifOpts = typeof alert.notificationOptions === 'string'
          ? JSON.parse(alert.notificationOptions || '{}')
          : (alert.notificationOptions || {});
      } catch { notifOpts = {}; }

      const alertForMode = notifOpts.alertForMode || 'whitelist';

      let syms;
      try { syms = JSON.parse(alert.symbols || '[]'); } catch { syms = [alert.symbols]; }
      const symList = Array.isArray(syms) ? syms : (syms ? [syms] : []);

      if (alert.alertType === 'complex' && alertForMode === 'all') {
        // For 'all' mode on per-symbol exchanges, we still add the exchange+market
        // but can't subscribe to every symbol. The alertEngine history feeder
        // will handle REST fallback for these.
        // Don't add individual symbols — just ensure the connection exists.
      } else {
        // Price alerts: track first symbol; Complex whitelist: track all symbols
        const symbolsToTrack = alert.alertType === 'complex' ? symList : (symList.length > 0 ? [symList[0]] : []);
        for (const s of symbolsToTrack) {
          if (!s) continue;
          const sym = String(s).toUpperCase().replace(/\.P$/i, '');
          if (!sym.endsWith('USDT') && !sym.endsWith('USD')) continue;
          if (ex === 'bybit') (mkt === 'spot' ? bybitSpotSyms : bybitFuturesSyms).add(sym);
          if (ex === 'bitget') (mkt === 'spot' ? bitgetSpotSyms : bitgetFuturesSyms).add(sym);
        }
      }
    }
  }

  // Update watched symbols
  watchedSymbols.bybit.futures = bybitFuturesSyms;
  watchedSymbols.bybit.spot = bybitSpotSyms;
  watchedSymbols.bitget.futures = bitgetFuturesSyms;
  watchedSymbols.bitget.spot = bitgetSpotSyms;

  // Connect to needed pairs
  for (const key of needed) {
    if (!connections.has(key)) {
      const [exchange, market] = key.split('|');
      connectExchange(exchange, market);
    }
  }

  // For Bybit/Bitget, update per-symbol subscriptions on existing connections
  for (const key of needed) {
    const [exchange, market] = key.split('|');
    if (exchange === 'bybit' || exchange === 'bitget') {
      updatePerSymbolSubscriptions(exchange, market);
    }
  }

  // Disconnect from unneeded pairs (except keep MEXC poll timers managed separately)
  for (const key of connections.keys()) {
    if (!needed.has(key)) {
      const conn = connections.get(key);
      closeConnection(key, conn, 'no-active-alerts');
      connections.delete(key);
    }
  }

  // Manage MEXC REST polling
  const needMexcFutures = needed.has('mexc|futures');
  const needMexcSpot = needed.has('mexc|spot');
  if (needMexcFutures && !mexcFuturesPollTimer) {
    mexcFuturesPollTimer = setInterval(() => pollMexcREST('futures'), REST_POLL_INTERVAL_MS);
    pollMexcREST('futures'); // immediate first poll
  } else if (!needMexcFutures && mexcFuturesPollTimer) {
    clearInterval(mexcFuturesPollTimer); mexcFuturesPollTimer = null;
  }
  if (needMexcSpot && !mexcSpotPollTimer) {
    mexcSpotPollTimer = setInterval(() => pollMexcREST('spot'), REST_POLL_INTERVAL_MS);
    pollMexcREST('spot');
  } else if (!needMexcSpot && mexcSpotPollTimer) {
    clearInterval(mexcSpotPollTimer); mexcSpotPollTimer = null;
  }
}

// ─── Exchange-specific connection logic ─────────────────────────────────────

function connectExchange(exchange, market) {
  const key = `${exchange}|${market}`;
  if (connections.has(key)) return;

  switch (exchange) {
    case 'binance': return connectBinance(market);
    case 'bybit':   return connectBybit(market);
    case 'okx':     return connectOKX(market);
    case 'gate':    return connectGate(market);
    case 'bitget':  return connectBitget(market);
    case 'mexc':    return; // handled by REST polling
    default:        console.warn(`[PriceWatcher] Unknown exchange: ${exchange}`);
  }
}

// ─── BINANCE ────────────────────────────────────────────────────────────────
// Single !miniTicker@arr stream → ALL tickers, ~1 s push frequency

function connectBinance(market) {
  const key = `binance|${market}`;
  const url = market === 'spot'
    ? 'wss://stream.binance.com:9443/ws/!miniTicker@arr'
    : 'wss://fstream.binance.com/ws/!miniTicker@arr';

  const ws = createWs(url, key, {
    onMessage(data) {
      try {
        const tickers = JSON.parse(data);
        if (!Array.isArray(tickers)) return;
        const map = prices.binance[market];
        const batch = {};
        for (const t of tickers) {
          if (t.s && t.c) {
            const p = Number(t.c);
            if (Number.isFinite(p) && p > 0) { map[t.s] = p; batch[t.s] = p; }
          }
        }
        lastUpdated.binance[market] = Date.now();
        emitTick('binance', market, batch);
      } catch { /* ignore malformed */ }
    },
  });

  connections.set(key, ws);
}

// ─── BYBIT ──────────────────────────────────────────────────────────────────
// Per-symbol tickers on one connection per market type

function connectBybit(market) {
  const key = `bybit|${market}`;
  const url = market === 'spot'
    ? 'wss://stream.bybit.com/v5/public/spot'
    : 'wss://stream.bybit.com/v5/public/linear';

  const ws = createWs(url, key, {
    pingInterval: 20000,
    pingPayload: JSON.stringify({ op: 'ping' }),
    onOpen(rawWs) {
      // Subscribe to all currently watched symbols
      const syms = watchedSymbols.bybit[market];
      if (syms.size > 0) {
        const args = Array.from(syms).map(s => `tickers.${s}`);
        rawWs.send(JSON.stringify({ op: 'subscribe', args }));
      }
    },
    onMessage(data) {
      try {
        const msg = JSON.parse(data);
        if (msg.topic && msg.topic.startsWith('tickers.') && msg.data) {
          const d = msg.data;
          const symbol = d.symbol || msg.topic.replace('tickers.', '');
          const p = Number(d.lastPrice);
          if (symbol && Number.isFinite(p) && p > 0) {
            prices.bybit[market][symbol] = p;
            lastUpdated.bybit[market] = Date.now();
            emitTick('bybit', market, { [symbol]: p });
          }
        }
      } catch { /* ignore */ }
    },
  });

  connections.set(key, ws);
}

function updatePerSymbolSubscriptions(exchange, market) {
  const key = `${exchange}|${market}`;
  const conn = connections.get(key);
  if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;

  if (exchange === 'bybit') {
    const syms = watchedSymbols.bybit[market];
    if (syms.size > 0) {
      const args = Array.from(syms).map(s => `tickers.${s}`);
      conn.ws.send(JSON.stringify({ op: 'subscribe', args }));
    }
  } else if (exchange === 'bitget') {
    const syms = watchedSymbols.bitget[market];
    const instType = market === 'spot' ? 'SPOT' : 'USDT-FUTURES';
    if (syms.size > 0) {
      const args = Array.from(syms).map(s => ({ instType, channel: 'ticker', instId: s }));
      conn.ws.send(JSON.stringify({ op: 'subscribe', args }));
    }
  }
}

// ─── OKX ────────────────────────────────────────────────────────────────────
// tickers channel with instType → gets ALL tickers for that instrument type

function connectOKX(market) {
  const key = `okx|${market}`;
  const url = 'wss://ws.okx.com:8443/ws/v5/public';
  const instType = market === 'spot' ? 'SPOT' : 'SWAP';

  const ws = createWs(url, key, {
    pingInterval: 25000,
    pingPayload: 'ping',
    onOpen(rawWs) {
      rawWs.send(JSON.stringify({
        op: 'subscribe',
        args: [{ channel: 'tickers', instType }],
      }));
    },
    onMessage(data) {
      try {
        // OKX sends "pong" as plain text
        if (data === 'pong') return;
        const msg = JSON.parse(data);
        if (msg.data && Array.isArray(msg.data)) {
          const map = prices.okx[market];
          const batch = {};
          for (const t of msg.data) {
            const instId = t.instId || '';
            const sym = instId.replace(/-SWAP$/i, '').replace(/-/g, '');
            const p = Number(t.last);
            if (sym && Number.isFinite(p) && p > 0) {
              map[sym] = p;
              batch[sym] = p;
            }
          }
          lastUpdated.okx[market] = Date.now();
          emitTick('okx', market, batch);
        }
      } catch { /* ignore */ }
    },
  });

  connections.set(key, ws);
}

// ─── GATE.IO ────────────────────────────────────────────────────────────────
// futures.tickers / spot.tickers with !all → ALL tickers

function connectGate(market) {
  const key = `gate|${market}`;
  const url = market === 'spot'
    ? 'wss://api.gateio.ws/ws/v4/'
    : 'wss://fx-ws.gateio.ws/v4/ws/usdt';

  const channel = market === 'spot' ? 'spot.tickers' : 'futures.tickers';

  const ws = createWs(url, key, {
    pingInterval: 15000,
    pingPayload: JSON.stringify({ channel, event: 'ping' }),
    onOpen(rawWs) {
      rawWs.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel,
        event: 'subscribe',
        payload: ['!all'],
      }));
    },
    onMessage(data) {
      try {
        const msg = JSON.parse(data);
        if (msg.event === 'update' && msg.result) {
          const map = prices.gate[market];
          const batch = {};
          const results = Array.isArray(msg.result) ? msg.result : [msg.result];
          for (const t of results) {
            const contract = t.contract || t.currency_pair || '';
            const sym = contract.replace(/_/g, '');
            const p = Number(t.last || t.close);
            if (sym && Number.isFinite(p) && p > 0) {
              map[sym] = p;
              batch[sym] = p;
            }
          }
          lastUpdated.gate[market] = Date.now();
          emitTick('gate', market, batch);
        }
      } catch { /* ignore */ }
    },
  });

  connections.set(key, ws);
}

// ─── BITGET ─────────────────────────────────────────────────────────────────
// Per-symbol ticker subscriptions on one connection

function connectBitget(market) {
  const key = `bitget|${market}`;
  const url = 'wss://ws.bitget.com/v2/ws/public';
  const instType = market === 'spot' ? 'SPOT' : 'USDT-FUTURES';

  const ws = createWs(url, key, {
    pingInterval: 30000,
    pingPayload: 'ping',
    onOpen(rawWs) {
      const syms = watchedSymbols.bitget[market];
      if (syms.size > 0) {
        const args = Array.from(syms).map(s => ({ instType, channel: 'ticker', instId: s }));
        rawWs.send(JSON.stringify({ op: 'subscribe', args }));
      }
    },
    onMessage(data) {
      try {
        if (data === 'pong') return;
        const msg = JSON.parse(data);
        if (msg.data && Array.isArray(msg.data)) {
          const map = prices.bitget[market];
          const batch = {};
          for (const t of msg.data) {
            const sym = t.instId || '';
            const p = Number(t.lastPr || t.last);
            if (sym && Number.isFinite(p) && p > 0) {
              map[sym] = p;
              batch[sym] = p;
            }
          }
          lastUpdated.bitget[market] = Date.now();
          emitTick('bitget', market, batch);
        }
      } catch { /* ignore */ }
    },
  });

  connections.set(key, ws);
}

// ─── MEXC (REST polling) ────────────────────────────────────────────────────
// MEXC WebSocket is unreliable; use REST polling with the existing service cache

async function pollMexcREST(market) {
  if (!running) return;
  try {
    const mexcService = require('./mexcService');
    const exchangeType = market === 'spot' ? 'spot' : 'futures';
    const map = await mexcService.getLastPricesBySymbols([], exchangeType, {
      strict: false,
      exchangeOnly: true,
    });
    if (map && typeof map === 'object') {
      prices.mexc[market] = {};
      const batch = {};
      for (const [sym, val] of Object.entries(map)) {
        const p = Number(val);
        if (Number.isFinite(p) && p > 0) { prices.mexc[market][sym] = p; batch[sym] = p; }
      }
      lastUpdated.mexc[market] = Date.now();
      emitTick('mexc', market, batch);
    }
  } catch (err) {
    console.warn(`[PriceWatcher] MEXC ${market} REST poll failed:`, err.message);
  }
}

// ─── Generic WebSocket wrapper ──────────────────────────────────────────────

function createWs(url, connectionKey, opts = {}) {
  const { onMessage, onOpen, pingInterval, pingPayload } = opts;
  const state = { ws: null, reconnectAttempts: 0, pingTimer: null, reconnectTimer: null };

  function connect() {
    if (!running) return;

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error(`[PriceWatcher] ${connectionKey} WS create failed:`, err.message);
      scheduleReconnect();
      return;
    }

    state.ws = ws;

    ws.on('open', () => {
      console.log(`[PriceWatcher] ${connectionKey} connected`);
      state.reconnectAttempts = 0;

      if (pingInterval && pingPayload) {
        state.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pingPayload);
          }
        }, pingInterval);
      }

      if (onOpen) onOpen(ws);
    });

    ws.on('message', (raw) => {
      const data = typeof raw === 'string' ? raw : raw.toString();
      if (onMessage) onMessage(data);
    });

    ws.on('close', (code) => {
      cleanup();
      if (running && connections.has(connectionKey)) {
        console.warn(`[PriceWatcher] ${connectionKey} closed (code=${code}), reconnecting...`);
        scheduleReconnect();
      }
    });

    ws.on('error', (err) => {
      console.error(`[PriceWatcher] ${connectionKey} error:`, err.message);
      // onclose will fire after this
    });
  }

  function cleanup() {
    if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
  }

  function scheduleReconnect() {
    if (!running) return;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempts), RECONNECT_MAX_MS);
    state.reconnectAttempts++;
    state.reconnectTimer = setTimeout(() => {
      if (running && connections.has(connectionKey)) connect();
    }, delay);
  }

  connect();
  return state;
}

function closeConnection(key, conn, reason) {
  if (!conn) return;
  if (conn.pingTimer) clearInterval(conn.pingTimer);
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
  if (conn.ws) {
    try { conn.ws.close(); } catch { /* ignore */ }
    conn.ws = null;
  }
  console.log(`[PriceWatcher] ${key} disconnected (${reason})`);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  start,
  stop,
  getPriceMap,
  isFresh,
  refreshSubscriptions,
  onTick,
  offTick,
};
