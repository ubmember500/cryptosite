/**
 * BinanceDensityScanner — Purpose-built for continuous background scanning.
 *
 * Unlike the existing BinanceFastScanner (designed for on-demand user scans
 * with 200 concurrent requests), this scanner is optimised for running every
 * 15-30 seconds without triggering Binance rate limits (HTTP 418).
 *
 * Key differences from BinanceFastScanner:
 *   - Pre-filters to top-volume symbols only to reduce API calls
 *   - Lower concurrency (20 per batch for futures, 30 for spot) with delays
 *   - Retry logic with exponential back-off on 418/429 responses
 *   - Spot uses data-api.binance.vision (no IP bans, no rate limits)
 *   - Futures uses fapi.binance.com with aggressive caching and back-off
 *   - Uses shared extractWalls() for consistent wall format
 *   - Returns walls with all required fields (market, originalSymbol, midPrice)
 */

const axios = require('axios');
const { extractWalls, normalizeSymbol, delay } = require('./utils');

// Futures: standard API (no vision alternative exists)
// Spot: use data-api.binance.vision — unrestricted, no 418 bans
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const BINANCE_SPOT_BASE    = 'https://data-api.binance.vision';

// Ticker endpoint: for spot we can optionally use the regular API
// to get the tickers (data-api.binance.vision also serves them)
const BINANCE_SPOT_TICKER  = 'https://data-api.binance.vision';

const CACHE_TTL         = 60000; // 60s cache — keeps API calls low for continuous scanning
const FUTURES_BATCH     = 20;    // 20 concurrent — conservative for futures fapi
const SPOT_BATCH        = 30;    // 30 concurrent — spot data-api is unrestricted
const FUTURES_DELAY     = 200;   // 200ms between batches (futures)
const SPOT_DELAY        = 80;    // 80ms between batches (spot, relaxed)
const MAX_RETRIES       = 2;     // retry up to 2 times on 418/429

class BinanceDensityScanner {
  constructor(market = 'futures') {
    this.market = market;
    this.isFutures = market === 'futures';
    this.baseURL = this.isFutures ? BINANCE_FUTURES_BASE : BINANCE_SPOT_BASE;
    this.batchSize = this.isFutures ? FUTURES_BATCH : SPOT_BATCH;
    this.batchDelay = this.isFutures ? FUTURES_DELAY : SPOT_DELAY;
    this.orderBookCache = new Map();
    this._rateLimited = false;       // flag: skip remaining batches if banned

    // Symbol list cache — refreshes every 5 minutes, not every scan cycle.
    // If the API fails, we fall back to the last known good list.
    this._symbolCache = null;        // cached symbol array
    this._symbolCacheTs = 0;         // timestamp of last successful fetch
  }

  // How long to cache the symbol list (5 minutes)
  static SYMBOL_CACHE_TTL = 5 * 60 * 1000;

  /**
   * Get USDT symbols filtered by 24h volume, sorted descending.
   * Caches for 5 minutes. Falls back to stale cache on API failure.
   */
  async getAllSymbols(minVolumeUSD = 0) {
    // Return cached list if still fresh
    if (this._symbolCache && Date.now() - this._symbolCacheTs < BinanceDensityScanner.SYMBOL_CACHE_TTL) {
      return this._symbolCache.filter(s => s.volumeUSD >= minVolumeUSD);
    }

    const endpoint = this.isFutures
      ? '/fapi/v1/ticker/24hr'
      : '/api/v3/ticker/24hr';
    const base = this.isFutures ? BINANCE_FUTURES_BASE : BINANCE_SPOT_TICKER;

    try {
      const response = await axios.get(`${base}${endpoint}`, {
        timeout: 12000,
      });

      const tickers = response.data || [];

      // Only USDT pairs, store ALL with volume data for flexible re-filtering
      const symbols = tickers
        .filter((t) => {
          const sym = t.symbol || '';
          return sym.endsWith('USDT');
        })
        .map((t) => ({
          symbol: t.symbol,
          volumeUSD: parseFloat(t.quoteVolume || 0),
        }))
        .sort((a, b) => b.volumeUSD - a.volumeUSD);

      // Update cache
      this._symbolCache = symbols;
      this._symbolCacheTs = Date.now();

      const filtered = symbols.filter(s => s.volumeUSD >= minVolumeUSD);
      console.log(
        `[BinanceDensity] ${this.market}: ${filtered.length} symbols with volume >= $${minVolumeUSD} (fresh)`
      );
      return filtered;
    } catch (error) {
      const status = error.response?.status;
      console.error(
        `[BinanceDensity] ${this.market}: ticker fetch failed — HTTP ${status || 'N/A'}: ${error.message}`
      );

      // Fall back to stale cache if available
      if (this._symbolCache) {
        const filtered = this._symbolCache.filter(s => s.volumeUSD >= minVolumeUSD);
        console.log(
          `[BinanceDensity] ${this.market}: using stale symbol cache (${filtered.length} symbols, age ${Math.round((Date.now() - this._symbolCacheTs) / 1000)}s)`
        );
        return filtered;
      }

      return [];
    }
  }

  /**
   * Fetch order book for a single symbol with cache.
   * Includes retry logic for 418/429 (rate limit) responses.
   * If _rateLimited is set, skip API calls entirely and return empty.
   */
  async fetchOrderBook(symbol, limit = 50) {
    // If we hit a 418 during this scan cycle, skip further API calls
    if (this._rateLimited) return { bids: [], asks: [] };

    const cacheKey = `${symbol}_${limit}`;
    const cached = this.orderBookCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const endpoint = this.isFutures ? '/fapi/v1/depth' : '/api/v3/depth';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.get(`${this.baseURL}${endpoint}`, {
          params: { symbol, limit },
          timeout: 5000,
        });

        const bids = (response.data.bids || []).map(([p, a]) => [parseFloat(p), parseFloat(a)]);
        const asks = (response.data.asks || []).map(([p, a]) => [parseFloat(p), parseFloat(a)]);

        const orderBook = { bids, asks };
        this.orderBookCache.set(cacheKey, { data: orderBook, timestamp: Date.now() });
        return orderBook;
      } catch (error) {
        const status = error.response?.status;

        // 418 = Binance IP ban, 429 = rate limit
        if (status === 418 || status === 429) {
          if (attempt < MAX_RETRIES) {
            const backoff = (attempt + 1) * 1000; // 1s, 2s
            console.warn(
              `[BinanceDensity] ${this.market}: ${status} for ${symbol}, retrying in ${backoff}ms...`
            );
            await delay(backoff);
            continue;
          }
          // After final retry, flag rate-limited to skip remaining symbols
          console.warn(
            `[BinanceDensity] ${this.market}: ${status} persists — skipping remaining symbols this cycle`
          );
          this._rateLimited = true;
          return { bids: [], asks: [] };
        }

        // All other errors — return empty silently
        return { bids: [], asks: [] };
      }
    }

    return { bids: [], asks: [] };
  }

  /**
   * Scan all qualifying symbols for walls.
   *
   * Workflow:
   *   1) Fetch top-volume USDT symbols
   *   2) Fetch order books in small batches with delays
   *   3) Extract walls using shared extractWalls()
   *
   * Returns walls sorted by volumeUSD descending.
   */
  async scanForWalls({
    minVolumeUSD = 0,
    minWallSize = 50000,
    depth = 5,
    radius = 1,
  } = {}) {
    const startTime = Date.now();
    const depthPercent = depth;

    // Pre-filter: only symbols with at least $500K 24h volume.
    // Symbols with less daily volume are very unlikely to have $50K+ walls.
    const volumeFloor = Math.max(minVolumeUSD, 500000);
    const symbols = await this.getAllSymbols(volumeFloor);

    if (symbols.length === 0) {
      console.log(`[BinanceDensity] ${this.market}: no symbols to scan`);
      return [];
    }

    console.log(`[BinanceDensity] ${this.market}: scanning ${symbols.length} symbols...`);

    // Reset rate-limit flag at the start of each scan cycle
    this._rateLimited = false;

    const allWalls = [];
    let processed = 0;
    const batchSize = this.batchSize;
    const batchDelay = this.batchDelay;

    for (let i = 0; i < symbols.length; i += batchSize) {
      // Abort early if rate-limited
      if (this._rateLimited) {
        console.warn(`[BinanceDensity] ${this.market}: aborting scan — rate limited`);
        break;
      }

      const batch = symbols.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(async ({ symbol: rawSymbol }) => {
          try {
            const orderBook = await this.fetchOrderBook(rawSymbol);

            if (orderBook.bids.length === 0 && orderBook.asks.length === 0) {
              return [];
            }

            const walls = extractWalls(orderBook, {
              exchange: 'binance',
              symbol: normalizeSymbol(rawSymbol, 'binance').normalized,
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
        `[BinanceDensity] ${this.market}: ${processed}/${symbols.length} (${pct}%)`
      );

      // Inter-batch delay to stay within rate limits
      if (i + batchSize < symbols.length) {
        await delay(batchDelay);
      }
    }

    allWalls.sort((a, b) => (b.volumeUSD || 0) - (a.volumeUSD || 0));

    const elapsed = Date.now() - startTime;
    console.log(
      `[BinanceDensity] ${this.market}: ✓ ${allWalls.length} walls in ${elapsed}ms`
    );

    return allWalls;
  }
}

module.exports = { BinanceDensityScanner };
