/**
 * BinanceFuturesWsScanner — WebSocket-based order book scanner for Binance Futures.
 *
 * Uses `wss://fstream.binance.com` partial depth streams (@depth20@500ms)
 * to maintain real-time order books for top futures symbols.
 *
 * Why WebSocket instead of REST?
 *   - fapi.binance.com REST API aggressively rate-limits (HTTP 418 bans)
 *   - Especially problematic from US datacenter IPs (Render)
 *   - WebSocket streams have ZERO rate limits
 *   - Data updates every 500ms — far fresher than 30s REST polling
 *
 * Trade-off: @depth20 gives top 20 bid/ask levels (not full depth).
 * This captures the most significant walls near the current price.
 * For less-liquid altcoins, 20 levels often spans 2-5% from mid.
 *
 * @module densityScanner/binanceFuturesWsScanner
 */

const WebSocket = require('ws');
const axios = require('axios');
const { extractWalls, normalizeSymbol } = require('./utils');

// ── Constants ───────────────────────────────────────────────────────────────

const WS_BASE = 'wss://fstream.binance.com/stream';
const REST_BASE = 'https://fapi.binance.com';

const RECONNECT_DELAY = 5000;                   // 5s between reconnect attempts
const SYMBOL_REFRESH_INTERVAL = 4 * 60 * 60000; // refresh symbol list every 4h
const MAX_SYMBOLS = 40;                          // top 40 by volume
const STALE_THRESHOLD = 30000;                   // 30s — skip books older than this

// Hardcoded top Binance futures symbols — used as fallback if REST ticker fails.
// These rarely change; the list is refreshed via REST every 4 hours when available.
const FALLBACK_SYMBOLS = [
  'BTCUSDT',    'ETHUSDT',    'SOLUSDT',    'XRPUSDT',    'DOGEUSDT',
  'BNBUSDT',    'SUIUSDT',    'ADAUSDT',    'TRXUSDT',    'AVAXUSDT',
  'LINKUSDT',   'DOTUSDT',    'LTCUSDT',    'PEPEUSDT',   'UNIUSDT',
  'ARBUSDT',    'OPUSDT',     'APTUSDT',    'NEARUSDT',   'FILUSDT',
  'ATOMUSDT',   'FTMUSDT',    'SHIBUSDT',   'WIFUSDT',    'RENDERUSDT',
  'INJUSDT',    'TIAUSDT',    'SEIUSDT',    'JUPUSDT',    'ONDOUSDT',
  'ENAUSDT',    'WLDUSDT',    'STXUSDT',    'IMXUSDT',    'GRTUSDT',
  'RUNEUSDT',   'AAVEUSDT',   'MKRUSDT',    'SNXUSDT',    'LDOUSDT',
];

// ── Scanner class ───────────────────────────────────────────────────────────

class BinanceFuturesWsScanner {
  constructor() {
    this.market = 'futures';

    // Live order book data fed by WebSocket — keyed by uppercase symbol
    this.orderBooks = new Map(); // symbol → { bids: [[p,q],...], asks: [[p,q],...], updatedAt }

    this.symbols = [...FALLBACK_SYMBOLS];
    this.ws = null;
    this._connected = false;
    this._connecting = false;
    this._reconnectTimer = null;
    this._symbolRefreshTimer = null;

    // Start async initialisation (don't block constructor)
    this._init();
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  /**
   * Fetch symbol list (best-effort) then open WebSocket.
   */
  async _init() {
    try {
      await this._fetchSymbols();
    } catch (e) {
      console.warn(`[BinanceFuturesWS] Symbol fetch failed, using ${this.symbols.length} fallback symbols`);
    }

    this._connect();

    // Periodically refresh the symbol list (top-volume symbols change slowly)
    this._symbolRefreshTimer = setInterval(() => {
      this._refreshSymbols();
    }, SYMBOL_REFRESH_INTERVAL);
  }

  // ── Symbol list management ──────────────────────────────────────────────

  /**
   * Fetch top futures USDT symbols by 24h volume.
   * Single REST call (weight 40), only at startup + every 4 hours.
   * Falls back gracefully to hardcoded list on failure.
   */
  async _fetchSymbols() {
    const res = await axios.get(`${REST_BASE}/fapi/v1/ticker/24hr`, {
      timeout: 15000,
    });
    const tickers = res.data || [];

    const symbols = tickers
      .filter(t => t.symbol?.endsWith('USDT'))
      .map(t => ({
        symbol: t.symbol,
        volumeUSD: parseFloat(t.quoteVolume || 0),
      }))
      .sort((a, b) => b.volumeUSD - a.volumeUSD)
      .slice(0, MAX_SYMBOLS)
      .map(t => t.symbol);

    if (symbols.length > 0) {
      this.symbols = symbols;
      console.log(`[BinanceFuturesWS] Loaded ${symbols.length} top symbols by volume`);
    }
  }

  /**
   * Refresh symbol list and reconnect WebSocket if the list changed.
   */
  async _refreshSymbols() {
    const oldSymbols = [...this.symbols];

    try {
      await this._fetchSymbols();
    } catch (e) {
      console.warn(`[BinanceFuturesWS] Symbol refresh failed: ${e.message}`);
      return;
    }

    // Check if the list actually changed
    const changed =
      this.symbols.length !== oldSymbols.length ||
      this.symbols.some((s, i) => s !== oldSymbols[i]);

    if (changed) {
      console.log('[BinanceFuturesWS] Symbol list changed — reconnecting WebSocket');
      this._disconnect();
      this._connect();
    }
  }

  // ── WebSocket connection ────────────────────────────────────────────────

  /**
   * Open a combined-stream WebSocket for @depth20@500ms on all tracked symbols.
   *
   * Binance futures partial depth stream sends a full snapshot of top 20
   * bid and ask levels every 500ms per symbol. No local book maintenance needed.
   */
  _connect() {
    if (this._connecting || this._connected) return;
    this._connecting = true;

    const streams = this.symbols.map(s => `${s.toLowerCase()}@depth20@500ms`);
    const url = `${WS_BASE}?streams=${streams.join('/')}`;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error(`[BinanceFuturesWS] Failed to create WebSocket: ${err.message}`);
      this._connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this._connected = true;
      this._connecting = false;
      console.log(`[BinanceFuturesWS] ✓ Connected — streaming ${streams.length} symbols`);
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (!msg.data) return;

        // Stream name: "btcusdt@depth20@500ms"
        const streamName = msg.stream || '';
        const symbol = streamName.split('@')[0].toUpperCase();
        if (!symbol) return;

        // Partial depth: { bids: [[price,qty],...], asks: [[price,qty],...] }
        // or legacy format: { b: [...], a: [...] }
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
      console.warn(`[BinanceFuturesWS] Disconnected (code: ${code})`);
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error(`[BinanceFuturesWS] WebSocket error: ${err.message}`);
      // onclose fires after onerror → will trigger reconnect
    });
  }

  /**
   * Cleanly close the WebSocket and clear timers.
   */
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

  /**
   * Schedule a reconnection attempt.
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      console.log('[BinanceFuturesWS] Reconnecting...');
      this._connect();
    }, RECONNECT_DELAY);
  }

  // ── Wall scanning ──────────────────────────────────────────────────────

  /**
   * Scan for density walls using in-memory order book data.
   *
   * This is INSTANT — no API calls. Reads directly from the WebSocket-fed
   * order book Map. Compatible with DensityScannerService orchestrator.
   *
   * @param {object} opts
   * @param {number} opts.minVolumeUSD  – ignored (volume filtering done at symbol level)
   * @param {number} opts.minWallSize   – minimum USD size to qualify as a wall
   * @param {number} opts.depth         – max % distance from mid price
   * @param {number} opts.radius        – grouping radius for nearby levels
   * @returns {Promise<Array>} walls sorted by volumeUSD descending
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
      console.log(
        `[BinanceFuturesWS] No order book data yet (connected: ${this._connected})`
      );
      return [];
    }

    const allWalls = [];
    let activeBooks = 0;
    let staleBooks = 0;

    for (const [symbol, ob] of this.orderBooks) {
      // Skip stale data (WebSocket might have disconnected briefly)
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
        market: 'futures',
      });

      if (walls?.length) {
        allWalls.push(...walls);
      }
    }

    allWalls.sort((a, b) => (b.volumeUSD || 0) - (a.volumeUSD || 0));

    const elapsed = Date.now() - startTime;
    console.log(
      `[BinanceFuturesWS] ✓ ${allWalls.length} walls from ${activeBooks} books in ${elapsed}ms` +
      (staleBooks > 0 ? ` (${staleBooks} stale skipped)` : '')
    );

    return allWalls;
  }
}

module.exports = { BinanceFuturesWsScanner };
