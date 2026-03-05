/**
 * BybitWsScanner — WebSocket-based order book scanner for Bybit.
 *
 * Supports both futures (linear) and spot markets:
 *   - Futures: wss://stream.bybit.com/v5/public/linear
 *   - Spot:    wss://stream.bybit.com/v5/public/spot
 *
 * Subscribes to orderbook.50.{SYMBOL} streams — 50-level order books.
 * Maintains books in memory via snapshot + delta updates.
 *
 * Why WebSocket instead of REST?
 *   - Bybit REST APIs can be rate-limited from US datacenter IPs
 *   - REST requires scanning 300+ symbols in batches → slow, uses quota
 *   - WebSocket: subscribe once, receive continuous updates, zero rate limits
 *   - Order books are always fresh (pushed on every change)
 *   - scanForWalls() reads from memory in ~1ms (instant)
 *
 * @module densityScanner/bybitWsScanner
 */

const WebSocket = require('ws');
const axios = require('axios');
const { extractWalls, normalizeSymbol } = require('./utils');

// ── Config per market ───────────────────────────────────────────────────────

const MARKET_CONFIG = {
  futures: {
    wsURL: 'wss://stream.bybit.com/v5/public/linear',
    category: 'linear',
    label: 'BybitWS:futures',
  },
  spot: {
    wsURL: 'wss://stream.bybit.com/v5/public/spot',
    category: 'spot',
    label: 'BybitWS:spot',
  },
};

// ── Constants ───────────────────────────────────────────────────────────────

const REST_BASE = 'https://api.bybit.com';
const REST_FALLBACK = 'https://api.bytick.com';

const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 20000;                     // Bybit requires ping every 20s
const SYMBOL_REFRESH_INTERVAL = 4 * 60 * 60000;  // refresh symbol list every 4h
const MAX_SYMBOLS = 50;                           // top 50 by volume
const STALE_THRESHOLD = 30000;                    // 30s — skip stale books
const SUBSCRIBE_BATCH = 10;                       // Bybit allows max 10 args per subscribe

// Top Bybit USDT symbols — hardcoded fallback.
const FALLBACK_SYMBOLS = [
  'BTCUSDT',   'ETHUSDT',   'SOLUSDT',   'XRPUSDT',   'DOGEUSDT',
  'BNBUSDT',   'SUIUSDT',   'ADAUSDT',   'TRXUSDT',   'AVAXUSDT',
  'LINKUSDT',  'DOTUSDT',   'LTCUSDT',   'PEPEUSDT',  'UNIUSDT',
  'ARBUSDT',   'OPUSDT',    'APTUSDT',   'NEARUSDT',  'FILUSDT',
  'ATOMUSDT',  'FTMUSDT',   'SHIBUSDT',  'WIFUSDT',   'RENDERUSDT',
  'INJUSDT',   'TIAUSDT',   'SEIUSDT',   'JUPUSDT',   'ONDOUSDT',
  'ENAUSDT',   'WLDUSDT',   'STXUSDT',   'IMXUSDT',   'GRTUSDT',
  'RUNEUSDT',  'AAVEUSDT',  'MKRUSDT',   'SNXUSDT',   'LDOUSDT',
  'FETUSDT',   'PENDLEUSDT','TONUSDT',   'KASUSDT',   'MATICUSDT',
  'ICPUSDT',   'HBARUSDT',  'VETUSDT',   'ALGOUSDT',  'XLMUSDT',
];

// ── Scanner class ───────────────────────────────────────────────────────────

class BybitWsScanner {
  /**
   * @param {'futures'|'spot'} market
   */
  constructor(market = 'futures') {
    this.market = market;
    const cfg = MARKET_CONFIG[market];
    if (!cfg) throw new Error(`Unknown market: ${market}`);

    this.cfg = cfg;
    this.label = cfg.label;

    /**
     * Order books maintained via snapshot + delta updates.
     * Map<symbol, { bids: Map<priceStr, qtyStr>, asks: Map<priceStr, qtyStr>, updatedAt }>
     * Using Map<priceStr, qtyStr> for O(1) delta updates; converted to sorted arrays for scanning.
     */
    this.orderBooks = new Map();

    this.symbols = [...FALLBACK_SYMBOLS];
    this.ws = null;
    this._connected = false;
    this._connecting = false;
    this._reconnectTimer = null;
    this._symbolRefreshTimer = null;
    this._pingTimer = null;

    this._init();
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  async _init() {
    try {
      await this._fetchSymbols();
    } catch (e) {
      console.warn(
        `[${this.label}] Symbol fetch failed (${e.message}), using ${this.symbols.length} fallback symbols`
      );
    }

    this._connect();

    this._symbolRefreshTimer = setInterval(() => {
      this._refreshSymbols();
    }, SYMBOL_REFRESH_INTERVAL);
  }

  // ── Symbol list management ──────────────────────────────────────────────

  /**
   * Fetch top USDT symbols by 24h turnover from Bybit REST API.
   * Tries primary and fallback domains.
   */
  async _fetchSymbols() {
    const bases = [REST_BASE, REST_FALLBACK];
    let tickers = null;

    for (const base of bases) {
      try {
        const res = await axios.get(`${base}/v5/market/tickers`, {
          params: { category: this.cfg.category },
          timeout: 10000,
        });
        tickers = res.data?.result?.list;
        if (tickers?.length) break;
      } catch (e) {
        console.warn(`[${this.label}] Ticker fetch failed from ${base}: ${e.response?.status || e.message}`);
      }
    }

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      throw new Error('All ticker endpoints failed');
    }

    const symbols = tickers
      .filter(t => t.symbol?.endsWith('USDT'))
      .map(t => ({
        symbol: t.symbol,
        volumeUSD: parseFloat(t.turnover24h || 0),
      }))
      .sort((a, b) => b.volumeUSD - a.volumeUSD)
      .slice(0, MAX_SYMBOLS)
      .map(t => t.symbol);

    if (symbols.length > 0) {
      this.symbols = symbols;
      console.log(`[${this.label}] Loaded ${symbols.length} top symbols by volume`);
    }
  }

  async _refreshSymbols() {
    const oldSymbols = [...this.symbols];
    try {
      await this._fetchSymbols();
    } catch (e) {
      console.warn(`[${this.label}] Symbol refresh failed: ${e.message}`);
      return;
    }

    const changed =
      this.symbols.length !== oldSymbols.length ||
      this.symbols.some((s, i) => s !== oldSymbols[i]);

    if (changed) {
      console.log(`[${this.label}] Symbol list changed — reconnecting`);
      this._disconnect();
      this._connect();
    }
  }

  // ── WebSocket connection ────────────────────────────────────────────────

  /**
   * Open WebSocket and subscribe to orderbook.50.{SYMBOL} for all symbols.
   *
   * Bybit V5 sends:
   *  - type "snapshot": full order book (50 bids + 50 asks)
   *  - type "delta": incremental updates (changed levels only, qty "0" = delete)
   *
   * We maintain full books via Map and convert to sorted arrays for scanning.
   */
  _connect() {
    if (this._connecting || this._connected) return;
    this._connecting = true;

    try {
      this.ws = new WebSocket(this.cfg.wsURL);
    } catch (err) {
      console.error(`[${this.label}] Failed to create WebSocket: ${err.message}`);
      this._connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this._connected = true;
      this._connecting = false;
      console.log(`[${this.label}] ✓ Connected`);

      // Subscribe in batches of 10 (Bybit limit: 10 args per subscribe message)
      this._subscribeAll();

      // Start ping timer (Bybit requires ping every 20s to keep connection alive)
      this._startPing();
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        // Pong response or subscription confirmation
        if (msg.op === 'pong' || msg.op === 'subscribe') return;

        // Order book update
        if (msg.topic && msg.topic.startsWith('orderbook.')) {
          this._handleOrderBookMessage(msg);
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });

    this.ws.on('close', (code) => {
      this._connected = false;
      this._connecting = false;
      this._stopPing();
      console.warn(`[${this.label}] Disconnected (code: ${code})`);
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error(`[${this.label}] WebSocket error: ${err.message}`);
    });
  }

  /**
   * Subscribe to orderbook.50 for all symbols, in batches of 10.
   */
  _subscribeAll() {
    const topics = this.symbols.map(s => `orderbook.50.${s}`);

    for (let i = 0; i < topics.length; i += SUBSCRIBE_BATCH) {
      const batch = topics.slice(i, i + SUBSCRIBE_BATCH);
      const msg = JSON.stringify({ op: 'subscribe', args: batch });

      try {
        this.ws.send(msg);
      } catch (e) {
        console.error(`[${this.label}] Failed to send subscribe batch: ${e.message}`);
      }
    }

    console.log(`[${this.label}] Subscribed to ${topics.length} order book streams`);
  }

  /**
   * Process an order book WebSocket message (snapshot or delta).
   */
  _handleOrderBookMessage(msg) {
    // topic: "orderbook.50.BTCUSDT"
    const parts = msg.topic.split('.');
    const symbol = parts[2];
    if (!symbol) return;

    const data = msg.data;
    if (!data) return;

    if (msg.type === 'snapshot') {
      // Full snapshot — replace entire book
      const bids = new Map();
      const asks = new Map();

      for (const [p, q] of (data.b || [])) {
        bids.set(p, q);
      }
      for (const [p, q] of (data.a || [])) {
        asks.set(p, q);
      }

      this.orderBooks.set(symbol, { bids, asks, updatedAt: Date.now() });
    } else if (msg.type === 'delta') {
      // Incremental update
      const book = this.orderBooks.get(symbol);
      if (!book) return; // no snapshot yet, skip delta

      for (const [p, q] of (data.b || [])) {
        if (q === '0') {
          book.bids.delete(p);
        } else {
          book.bids.set(p, q);
        }
      }

      for (const [p, q] of (data.a || [])) {
        if (q === '0') {
          book.asks.delete(p);
        } else {
          book.asks.set(p, q);
        }
      }

      book.updatedAt = Date.now();
    }
  }

  /**
   * Convert internal Map-based book to sorted arrays for extractWalls().
   */
  _getOrderBookArrays(symbol) {
    const book = this.orderBooks.get(symbol);
    if (!book) return { bids: [], asks: [] };

    const bids = [...book.bids.entries()]
      .map(([p, q]) => [parseFloat(p), parseFloat(q)])
      .sort((a, b) => b[0] - a[0]); // descending by price

    const asks = [...book.asks.entries()]
      .map(([p, q]) => [parseFloat(p), parseFloat(q)])
      .sort((a, b) => a[0] - b[0]); // ascending by price

    return { bids, asks };
  }

  // ── Ping/pong (Bybit keepalive) ────────────────────────────────────────

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws && this._connected) {
        try {
          this.ws.send(JSON.stringify({ op: 'ping' }));
        } catch (e) { /* ignore */ }
      }
    }, PING_INTERVAL);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  // ── Disconnect / reconnect ─────────────────────────────────────────────

  _disconnect() {
    this._stopPing();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (e) { /* ignore */ }
      this.ws = null;
    }
    this._connected = false;
    this._connecting = false;
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      console.log(`[${this.label}] Reconnecting...`);
      this._connect();
    }, RECONNECT_DELAY);
  }

  // ── Wall scanning ──────────────────────────────────────────────────────

  /**
   * Scan for density walls using in-memory order book data.
   *
   * INSTANT — no API calls. Reads from WebSocket-maintained books.
   * 50 levels × 50 symbols = good wall coverage.
   */
  async scanForWalls({
    minVolumeUSD = 0,
    minWallSize = 50000,
    depth = 5,
    radius = 1,
  } = {}) {
    const startTime = Date.now();
    const now = Date.now();

    if (this.orderBooks.size === 0) {
      console.log(`[${this.label}] No order book data yet (connected: ${this._connected})`);
      return [];
    }

    const allWalls = [];
    let activeBooks = 0;
    let staleBooks = 0;

    for (const [symbol, book] of this.orderBooks) {
      if (now - book.updatedAt > STALE_THRESHOLD) {
        staleBooks++;
        continue;
      }

      const ob = this._getOrderBookArrays(symbol);
      if (ob.bids.length === 0 && ob.asks.length === 0) continue;

      activeBooks++;

      const walls = extractWalls(ob, {
        exchange: 'bybit',
        symbol: normalizeSymbol(symbol, 'bybit').normalized,
        originalSymbol: symbol,
        depthPercent: depth,
        minWallSize,
        radius,
        market: this.market,
      });

      if (walls?.length) {
        allWalls.push(...walls);
      }
    }

    allWalls.sort((a, b) => (b.volumeUSD || 0) - (a.volumeUSD || 0));

    const elapsed = Date.now() - startTime;
    console.log(
      `[${this.label}] ✓ ${allWalls.length} walls from ${activeBooks} books in ${elapsed}ms` +
      (staleBooks > 0 ? ` (${staleBooks} stale skipped)` : '')
    );

    return allWalls;
  }
}

module.exports = { BybitWsScanner };
