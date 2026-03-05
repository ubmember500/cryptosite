/**
 * BinanceProxyScanner — Full-coverage Binance order book scanner.
 *
 * Scans ALL USDT symbols on Binance (640+ futures, 400+ spot) for density
 * walls by routing through Vercel serverless proxy functions.
 *
 * Architecture:
 *   Binance blocks cloud-provider IPs (Render/AWS). This scanner routes
 *   requests through Vercel functions running in Singapore (sin1), which
 *   can reach Binance successfully.
 *
 * Multi-batch approach:
 *   1. Symbol discovery: One Vercel call with symbolsOnly=1 fetches ALL
 *      USDT symbols (cached 5 min). No depth data — lightweight.
 *   2. Depth scanning: The full symbol list is split into batches of ~150.
 *      All batches fire in parallel via separate Vercel function calls.
 *      Each function fetches ~150 order books in ~300ms from Singapore.
 *   3. Wall extraction: Merged books are processed through extractWalls().
 *
 * Full scan of 640 futures symbols completes in ~2-4s (5 parallel batches).
 * Runs every 15s to keep wall data fresh.
 *
 * @module densityScanner/binanceProxyScanner
 */

const axios = require('axios');
const { extractWalls, normalizeSymbol } = require('./utils');

const DEFAULT_PROXY_URL = 'https://cryptosite2027.vercel.app';
const SYMBOL_CACHE_TTL = 5 * 60 * 1000;   // 5 minutes — refresh symbol list
const BATCH_SIZE = 150;                     // symbols per Vercel function call
const DEPTH_LIMIT = 50;                     // order book levels per side (50 bid + 50 ask)
                                            // Binance futures weight: limit≤50 = 2 per call
                                            // Binance spot weight:    limit≤100 = 5 per call
const BATCH_TIMEOUT = 12000;                // 12s timeout per batch (Vercel has 10s limit)

class BinanceProxyScanner {
  /**
   * @param {'futures'|'spot'} market
   */
  constructor(market = 'futures') {
    this.market = market;
    this.proxyURL = process.env.VERCEL_PROXY_URL || DEFAULT_PROXY_URL;
    this.cachedSymbols = null;
    this.symbolsCachedAt = 0;
  }

  /**
   * Fetch ALL USDT symbols from Binance via the Vercel proxy.
   * Uses symbolsOnly=1 mode — returns just the symbol list, no depth data.
   * Single lightweight API call (~200ms).
   */
  async _fetchAllSymbols() {
    const label = `[BinanceProxy:${this.market}]`;

    try {
      const response = await axios.get(`${this.proxyURL}/api/binance-depth`, {
        params: { market: this.market, symbolsOnly: '1' },
        timeout: 10000,
        headers: { Accept: 'application/json' },
      });

      const { symbols, symbolCount, source } = response.data;

      if (symbols && symbols.length > 0) {
        this.cachedSymbols = symbols;
        this.symbolsCachedAt = Date.now();
        console.log(`${label} discovered ${symbolCount} symbols (${source})`);
        return symbols;
      }
    } catch (error) {
      console.error(`${label} symbol discovery failed: ${error.message}`);
    }

    return this.cachedSymbols || [];
  }

  /**
   * Get the full symbol list, using cache if fresh.
   */
  async _getSymbols() {
    const cacheExpired = Date.now() - this.symbolsCachedAt > SYMBOL_CACHE_TTL;

    if (this.cachedSymbols && this.cachedSymbols.length > 0 && !cacheExpired) {
      return this.cachedSymbols;
    }

    return this._fetchAllSymbols();
  }

  /**
   * Fetch order books for a batch of symbols via one Vercel proxy call.
   * Returns { books: {...}, symbolCount, elapsed }.
   */
  async _fetchBatch(symbols, batchIndex) {
    const label = `[BinanceProxy:${this.market}]`;

    try {
      const response = await axios.get(`${this.proxyURL}/api/binance-depth`, {
        params: {
          market: this.market,
          symbols: symbols.join(','),
          limit: DEPTH_LIMIT,
        },
        timeout: BATCH_TIMEOUT,
        headers: { Accept: 'application/json' },
      });

      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.error || error.message;
      console.error(`${label} batch ${batchIndex} failed (${symbols.length} syms) — HTTP ${status || 'N/A'}: ${msg}`);
      return { books: {}, symbolCount: 0 };
    }
  }

  /**
   * Scan ALL Binance symbols for density walls.
   *
   * Flow:
   *  1. Get full symbol list (cached 5 min, ~640 futures / ~400 spot)
   *  2. Split into batches of BATCH_SIZE (~150)
   *  3. Fire ALL batches in parallel via Vercel proxy
   *  4. Merge all order books from all batches
   *  5. Extract walls from each book
   *  6. Return sorted walls
   *
   * Compatible with DensityScannerService orchestrator interface.
   */
  async scanForWalls({
    minVolumeUSD = 0,
    minWallSize = 50000,
    depth = 5,
    radius = 1,
  } = {}) {
    const startTime = Date.now();
    const label = `[BinanceProxy:${this.market}]`;

    try {
      // Step 1: Get all symbols
      const allSymbols = await this._getSymbols();

      if (allSymbols.length === 0) {
        console.log(`${label} no symbols available`);
        return [];
      }

      // Step 2: Split into batches
      const batches = [];
      for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
        batches.push(allSymbols.slice(i, i + BATCH_SIZE));
      }

      // Step 3: Fire all batches in parallel
      const batchResults = await Promise.allSettled(
        batches.map((batch, idx) => this._fetchBatch(batch, idx))
      );

      // Step 4: Merge all books
      const allBooks = {};
      let totalBookCount = 0;
      let failedBatches = 0;

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value?.books) {
          const books = result.value.books;
          for (const [sym, book] of Object.entries(books)) {
            allBooks[sym] = book;
          }
          totalBookCount += result.value.symbolCount || 0;
        } else {
          failedBatches++;
        }
      }

      if (totalBookCount === 0) {
        console.log(`${label} all ${batches.length} batches returned 0 books`);
        return [];
      }

      // Step 5: Extract walls from each book
      const allWalls = [];

      for (const [symbol, rawBook] of Object.entries(allBooks)) {
        const bids = (rawBook.bids || []).map(([p, q]) => [parseFloat(p), parseFloat(q)]);
        const asks = (rawBook.asks || []).map(([p, q]) => [parseFloat(p), parseFloat(q)]);

        if (bids.length === 0 && asks.length === 0) continue;

        const walls = extractWalls(
          { bids, asks },
          {
            exchange: 'binance',
            symbol: normalizeSymbol(symbol, 'binance').normalized,
            originalSymbol: symbol,
            depthPercent: depth,
            minWallSize,
            radius,
            market: this.market,
          }
        );

        if (walls?.length) {
          allWalls.push(...walls);
        }
      }

      allWalls.sort((a, b) => (b.volumeUSD || 0) - (a.volumeUSD || 0));

      const elapsed = Date.now() - startTime;
      const failInfo = failedBatches > 0 ? ` (${failedBatches} batches failed)` : '';
      console.log(
        `${label} ✓ ${allWalls.length} walls from ${totalBookCount}/${allSymbols.length} books ` +
        `(${batches.length} batches) in ${elapsed}ms${failInfo}`
      );

      return allWalls;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`${label} scan error after ${elapsed}ms: ${error.message}`);
      return [];
    }
  }
}

module.exports = { BinanceProxyScanner };
