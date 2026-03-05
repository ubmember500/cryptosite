const axios = require('axios');
const { extractWalls, normalizeSymbol, delay } = require('./utils');

const BYBIT_BASE     = 'https://api.bybit.com';
const BYBIT_FALLBACK = 'https://api.bytick.com';  // Alternative domain if primary fails
const CACHE_TTL = 60000;   // 60s order-book cache (was 30s — reduces API load)
const BATCH_SIZE = 40;     // 40 concurrent (was 80 — safer for continuous scanning)
const BATCH_DELAY = 150;   // 150ms between batches

class BybitFastScanner {
  constructor(market = 'futures') {
    this.market = market;
    this.category = market === 'futures' ? 'linear' : 'spot';
    this.orderBookCache = new Map();
    this.baseURL = BYBIT_BASE;        // may be swapped to fallback on failure

    // Symbol list cache — refreshes every 5 minutes, not every scan cycle.
    this._symbolCache = null;
    this._symbolCacheTs = 0;
  }

  static SYMBOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get all USDT symbols from Bybit, sorted by 24h volume descending.
   * Caches for 5 minutes. Falls back to stale cache on API failure.
   * Tries fallback domain (api.bytick.com) if primary fails.
   */
  async getAllSymbols(minVolumeUSD = 0) {
    // Return cached list if still fresh
    if (this._symbolCache && Date.now() - this._symbolCacheTs < BybitFastScanner.SYMBOL_CACHE_TTL) {
      return this._symbolCache.filter(s => s.volumeUSD >= minVolumeUSD);
    }

    // Try primary, then fallback
    const bases = [this.baseURL, BYBIT_FALLBACK];
    for (const base of bases) {
      try {
        const response = await axios.get(`${base}/v5/market/tickers`, {
          params: { category: this.category },
          timeout: 10000,
        });

        const tickers = response.data?.result?.list || [];

        const symbols = tickers
          .filter((t) => t.symbol && t.symbol.endsWith('USDT'))
          .map((t) => ({
            symbol: t.symbol,
            volumeUSD: parseFloat(t.turnover24h) || 0,
          }))
          .sort((a, b) => b.volumeUSD - a.volumeUSD);

        // Update cache and remember which base worked
        this._symbolCache = symbols;
        this._symbolCacheTs = Date.now();
        this.baseURL = base; // stick with working domain

        const filtered = symbols.filter(s => s.volumeUSD >= minVolumeUSD);
        console.log(
          `[BybitFast] ${this.market}: ${filtered.length} symbols with volume >= ${minVolumeUSD} USD (fresh, via ${base})`
        );
        return filtered;
      } catch (error) {
        const status = error.response?.status;
        console.error(
          `[BybitFast] ${this.market}: ticker fetch failed (${base}) — HTTP ${status || 'N/A'}: ${error.message}`
        );
        // Try next base
      }
    }

    // All bases failed — use stale cache if available
    if (this._symbolCache) {
      const filtered = this._symbolCache.filter(s => s.volumeUSD >= minVolumeUSD);
      console.log(
        `[BybitFast] ${this.market}: using stale symbol cache (${filtered.length} symbols, age ${Math.round((Date.now() - this._symbolCacheTs) / 1000)}s)`
      );
      return filtered;
    }

    return [];
  }

  /**
   * Fetch order book for a single symbol with 60s cache.
   * Uses whichever base domain worked for the ticker call.
   */
  async fetchOrderBook(symbol, limit = 50) {
    const cacheKey = `${symbol}_${limit}`;
    const cached = this.orderBookCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await axios.get(`${this.baseURL}/v5/market/orderbook`, {
        params: {
          category: this.category,
          symbol,
          limit,
        },
        timeout: 5000,
      });

      const result = response.data?.result || {};
      const bids = (result.b || []).map(([price, size]) => [
        parseFloat(price),
        parseFloat(size),
      ]);
      const asks = (result.a || []).map(([price, size]) => [
        parseFloat(price),
        parseFloat(size),
      ]);

      const orderBook = { bids, asks };

      this.orderBookCache.set(cacheKey, {
        data: orderBook,
        timestamp: Date.now(),
      });

      return orderBook;
    } catch (error) {
      // Silent failure for individual symbols
      return { bids: [], asks: [] };
    }
  }

  /**
   * Scan all symbols for walls.
   * Steps:
   *   1) Get all symbols (cached 5 min)
   *   2) Fetch order books in batches of 40 with 150ms delays
   *   3) Extract walls using shared utils
   * Returns walls sorted by volumeUSD descending.
   */
  async scanForWalls({
    minVolumeUSD = 0,
    minWallSize = 300000,
    depth = 10,
    radius = 1,
  } = {}) {
    const startTime = Date.now();
    const depthPercent = depth;

    // Pre-filter to top-volume symbols only
    const volumeFloor = Math.max(minVolumeUSD, 500000);
    const symbols = await this.getAllSymbols(volumeFloor);
    if (symbols.length === 0) {
      console.log(`[BybitFast] ${this.market}: no symbols to scan`);
      return [];
    }

    console.log(`[BybitFast] ${this.market}: scanning ${symbols.length} symbols...`);

    const allWalls = [];
    let processed = 0;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async ({ symbol: rawSymbol }) => {
          try {
            const orderBook = await this.fetchOrderBook(rawSymbol);

            if (orderBook.bids.length === 0 && orderBook.asks.length === 0) {
              return [];
            }

            const walls = extractWalls(orderBook, {
              exchange: 'bybit',
              symbol: normalizeSymbol(rawSymbol, 'bybit').normalized,
              originalSymbol: rawSymbol,
              depthPercent,
              minWallSize,
              radius,
              market: this.market,
            });

            return walls || [];
          } catch (error) {
            return [];
          }
        })
      );

      for (const walls of results) {
        allWalls.push(...walls);
      }

      processed += batch.length;
      const pct = Math.round((processed / symbols.length) * 100);
      console.log(
        `[BybitFast] ${this.market}: ${processed}/${symbols.length} (${pct}%)`
      );

      // Delay between batches to stay within rate limits
      if (i + BATCH_SIZE < symbols.length) {
        await delay(BATCH_DELAY);
      }
    }

    allWalls.sort((a, b) => (b.volumeUSD || 0) - (a.volumeUSD || 0));

    const elapsed = Date.now() - startTime;
    console.log(
      `[BybitFast] ${this.market}: ✓ ${allWalls.length} walls in ${elapsed}ms`
    );

    return allWalls;
  }
}

module.exports = { BybitFastScanner };
