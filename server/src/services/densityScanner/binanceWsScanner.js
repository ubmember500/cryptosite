/**
 * BinanceWsScanner — WebSocket-based order book scanner for Binance.
 *
 * Supports both futures and spot markets:
 *   - Futures: wss://fstream.binance.com  (USDⓈ-M perpetuals)
 *   - Spot:    wss://stream.binance.com   (spot pairs)
 *
 * Uses partial depth streams (@depth20@500ms) — full 20-level snapshots
 * pushed every 500ms. No local book maintenance needed (no deltas).
 *
 * Why WebSocket instead of REST?
 *   - Binance REST APIs return HTTP 418 (IP ban) from US datacenter IPs (Render)
 *   - Even data-api.binance.vision can get blocked from specific IPs
 *   - WebSocket streams have ZERO rate limits on public market data
 *   - Data updates every 500ms — far fresher than 30s REST polling
 *   - scanForWalls() reads from memory in ~1ms (instant)
 *
 * Trade-off: @depth20 gives top 20 bid/ask levels (not full depth).
 * This captures the most significant walls near the current price.
 *
 * @module densityScanner/binanceWsScanner
 */

const WebSocket = require('ws');
const axios = require('axios');
const { extractWalls, normalizeSymbol } = require('./utils');

// ── Config per market ───────────────────────────────────────────────────────

const MARKET_CONFIG = {
  futures: {
    wsBase: 'wss://fstream.binance.com/stream',
    restBase: 'https://fapi.binance.com',
    tickerEndpoint: '/fapi/v1/ticker/24hr',
    volumeField: 'quoteVolume',
    // Futures supports 100ms, 250ms, 500ms update speeds
    streamSuffix: '@depth20@500ms',
    label: 'BinanceWS:futures',
  },
  spot: {
    wsBase: 'wss://stream.binance.com:9443/stream',
    restBase: 'https://data-api.binance.vision',
    tickerEndpoint: '/api/v3/ticker/24hr',
    volumeField: 'quoteVolume',
    // Spot only supports 100ms or 1000ms (NOT 500ms!)
    streamSuffix: '@depth20@100ms',
    label: 'BinanceWS:spot',
  },
};

// ── Constants ───────────────────────────────────────────────────────────────

const RECONNECT_DELAY = 5000;                    // 5s between reconnect attempts
const SYMBOL_REFRESH_INTERVAL = 4 * 60 * 60000;  // refresh symbol list every 4h
const MAX_SYMBOLS = 50;                           // top 50 by volume
const STALE_THRESHOLD = 30000;                    // 30s — skip books older than this

// Top Binance USDT symbols — hardcoded fallback if ALL REST endpoints fail.
// Covers both futures and spot (spot has all of these; futures has most).
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

class BinanceWsScanner {
  /**
   * @param {'futures'|'spot'} market
   */
  constructor(market = 'futures') {
    this.market = market;
    const cfg = MARKET_CONFIG[market];
    if (!cfg) throw new Error(`Unknown market: ${market}`);

    this.cfg = cfg;
    this.label = cfg.label;

    // Live order book data fed by WebSocket — keyed by uppercase symbol
    this.orderBooks = new Map();

    this.symbols = [...FALLBACK_SYMBOLS];
    this.ws = null;
    this._connected = false;
    this._connecting = false;
    this._reconnectTimer = null;
    this._symbolRefreshTimer = null;
    this._pingTimer = null;

    // Start async initialisation (don't block constructor)
    this._init();
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  async _init() {
    // Try to fetch real symbol list; gracefully fall back to hardcoded
    try {
      await this._fetchSymbols();
    } catch (e) {
      console.warn(
        `[${this.label}] Symbol fetch failed (${e.message}), using ${this.symbols.length} fallback symbols`
      );
    }

    this._connect();

    // Periodically refresh symbol list (top-volume symbols shift slowly)
    this._symbolRefreshTimer = setInterval(() => {
      this._refreshSymbols();
    }, SYMBOL_REFRESH_INTERVAL);
  }

  // ── Symbol list management ──────────────────────────────────────────────

  /**
   * Fetch top USDT symbols by 24h volume via REST.
   * Single call, only at startup + every 4 hours.
   */
  async _fetchSymbols() {
    // Try multiple REST endpoints for resilience
    const endpoints = [
      `${this.cfg.restBase}${this.cfg.tickerEndpoint}`,
    ];
    // For spot, also try the CDN vision endpoint
    if (this.market === 'spot') {
      endpoints.push(`https://api.binance.com/api/v3/ticker/24hr`);
    }
    // For futures, try alternative domains
    if (this.market === 'futures') {
      endpoints.push(`https://fapi.binance.com/fapi/v1/ticker/24hr`);
    }

    let tickers = null;
    for (const url of endpoints) {
      try {
        const res = await axios.get(url, { timeout: 15000 });
        tickers = res.data;
        break;
      } catch (e) {
        console.warn(`[${this.label}] Ticker fetch failed from ${url}: ${e.response?.status || e.message}`);
      }
    }

    if (!tickers || !Array.isArray(tickers)) {
      throw new Error('All ticker endpoints failed');
    }

    const symbols = tickers
      .filter(t => t.symbol?.endsWith('USDT'))
      .map(t => ({
        symbol: t.symbol,
        volumeUSD: parseFloat(t[this.cfg.volumeField] || 0),
      }))
      .sort((a, b) => b.volumeUSD - a.volumeUSD)
      .slice(0, MAX_SYMBOLS)
      .map(t => t.symbol);

    if (symbols.length > 0) {
      this.symbols = symbols;
      console.log(`[${this.label}] Loaded ${symbols.length} top symbols by volume`);
    }
  }

  /**
   * Refresh symbols and reconnect WebSocket if the list changed.
   */
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
   * Open a combined-stream WebSocket for @depth20@500ms on all tracked symbols.
   *
   * Binance partial depth stream sends a FULL snapshot of top 20 bid + 20 ask
   * levels every 500ms per symbol. No local book maintenance needed.
   */
  _connect() {
    if (this._connecting || this._connected) return;
    this._connecting = true;

    const streams = this.symbols.map(s => `${s.toLowerCase()}${this.cfg.streamSuffix}`);
    const url = `${this.cfg.wsBase}?streams=${streams.join('/')}`;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error(`[${this.label}] Failed to create WebSocket: ${err.message}`);
      this._connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this._connected = true;
      this._connecting = false;
      console.log(`[${this.label}] ✓ Connected — streaming ${streams.length} symbols`);
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (!msg.data) return;

        const streamName = msg.stream || '';
        const symbol = streamName.split('@')[0].toUpperCase();
        if (!symbol) return;

        // Partial depth format: { bids: [[p,q],...], asks: [[p,q],...] }
        const rawBids = msg.data.bids || msg.data.b || [];
        const rawAsks = msg.data.asks || msg.data.a || [];

        const bids = rawBids.map(([p, a]) => [parseFloat(p), parseFloat(a)]);
        const asks = rawAsks.map(([p, a]) => [parseFloat(p), parseFloat(a)]);

        this.orderBooks.set(symbol, { bids, asks, updatedAt: Date.now() });
      } catch (e) {
        // Silently ignore malformed messages
      }
    });

    this.ws.on('close', (code) => {
      this._connected = false;
      this._connecting = false;
      console.warn(`[${this.label}] Disconnected (code: ${code})`);
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error(`[${this.label}] WebSocket error: ${err.message}`);
      // onclose fires after onerror → will trigger reconnect
    });
  }

  _disconnect() {
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
   * INSTANT — no API calls. Reads directly from the WebSocket-fed Map.
   * Compatible with DensityScannerService orchestrator (same interface as REST scanners).
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

    for (const [symbol, ob] of this.orderBooks) {
      if (now - ob.updatedAt > STALE_THRESHOLD) {
        staleBooks++;
        continue;
      }
      if (ob.bids.length === 0 && ob.asks.length === 0) continue;

      activeBooks++;

      const walls = extractWalls(ob, {
        exchange: 'binance',
        symbol: normalizeSymbol(symbol, 'binance').normalized,
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

module.exports = { BinanceWsScanner };
