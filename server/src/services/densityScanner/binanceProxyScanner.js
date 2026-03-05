/**
 * BinanceProxyScanner — Full-coverage Binance order book scanner.
 *
 * Scans ALL USDT symbols on Binance (640+ futures, 400+ spot) for density
 * walls by routing through Vercel serverless proxy functions in Singapore.
 *
 * Rate-limit-safe group rotation:
 *   Binance futures allows 2400 API weight/min. Each depth call at limit=100
 *   costs 5 weight. So max ~480 calls/min → ~120 per 15s cycle.
 *   With 640 symbols, we split into 6 groups of ~107 and rotate:
 *     Cycle 1 → group 0 (syms 1-107)
 *     Cycle 2 → group 1 (syms 108-214)
 *     ...
 *     Cycle 6 → group 5 (syms 535-640)
 *     Cycle 7 → group 0 again
 *   Full rotation: 6 × 15s = 90s. All symbols scanned every 90s.
 *   WallTracker retains walls for 10 min, so 90s rotation is fine.
 *
 *   Binance spot has a 6000 weight/min limit → 300 calls/cycle → 3 groups → 45s rotation.
 *
 * Multi-batch within each group:
 *   Each group may have more symbols than fit in one Vercel function call.
 *   Groups are split into batches of 150 symbols and fired in parallel.
 *
 * @module densityScanner/binanceProxyScanner
 */

const axios = require('axios');
const { extractWalls, normalizeSymbol } = require('./utils');

const DEFAULT_PROXY_URL = 'https://cryptosite2027.vercel.app';

// ── Rate limit configuration per market ─────────────────────────────────────

const MARKET_CONFIG = {
  futures: {
    depthLimit: 100,        // 100 levels per side (adequate for wall detection at 1-5% depth)
    depthWeight: 5,         // Binance API weight: limit=100 → weight 5
    rateLimitPerMin: 2400,  // Binance futures /fapi/v1 rate limit
  },
  spot: {
    depthLimit: 50,         // 50 levels per side (spot weight: limit≤100 → weight 5)
    depthWeight: 5,         // Binance API weight: limit≤100 → weight 5
    rateLimitPerMin: 6000,  // Binance spot /api/v3 rate limit (more generous)
  },
};

const SCAN_INTERVAL_MS = 15000;         // Must match orchestrator interval
const RATE_LIMIT_SAFETY = 0.90;         // Use 90% of rate limit budget
const SYMBOL_CACHE_TTL = 5 * 60 * 1000; // 5 min symbol list cache
const BATCH_SIZE = 150;                  // Max symbols per Vercel function call
const BATCH_TIMEOUT = 12000;             // Per-batch HTTP timeout (Vercel has 10s function limit)

class BinanceProxyScanner {
  /**
   * @param {'futures'|'spot'} market
   */
  constructor(market = 'futures') {
    this.market = market;
    this.proxyURL = process.env.VERCEL_PROXY_URL || DEFAULT_PROXY_URL;
    this.cachedSymbols = null;
    this.symbolsCachedAt = 0;

    // Group rotation state
    this.currentGroupIndex = 0;
    this._groups = null;
    this._groupsSymbolCount = 0; // Track when to rebuild groups
  }

  /**
   * Fetch ALL USDT symbols from Binance via the Vercel proxy.
   * Uses symbolsOnly=1 mode — no depth data fetched. Single lightweight call.
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
   * Build rotation groups from the symbol list based on rate limits.
   *
   * Computes how many symbols can be scanned per 15s cycle without
   * exceeding the Binance rate limit, then splits the full list into
   * that many groups for round-robin rotation.
   */
  _buildGroups(symbols) {
    const cfg = MARKET_CONFIG[this.market];
    const scansPerMin = Math.ceil(60000 / SCAN_INTERVAL_MS); // 4 at 15s

    // Max symbols we can safely scan per cycle
    const maxPerCycle = Math.floor(
      (cfg.rateLimitPerMin * RATE_LIMIT_SAFETY) / cfg.depthWeight / scansPerMin
    );
    // futures: floor(2400 * 0.9 / 5 / 4) = 108
    // spot:    floor(6000 * 0.9 / 5 / 4) = 270

    const groups = [];
    for (let i = 0; i < symbols.length; i += maxPerCycle) {
      groups.push(symbols.slice(i, i + maxPerCycle));
    }

    const rotationSec = groups.length * SCAN_INTERVAL_MS / 1000;
    console.log(
      `[BinanceProxy:${this.market}] Built ${groups.length} groups of ~${maxPerCycle} ` +
      `(${symbols.length} total symbols, full rotation: ${rotationSec}s)`
    );

    this._groups = groups;
    this._groupsSymbolCount = symbols.length;
    return groups;
  }

  /**
   * Fetch order books for a batch of symbols via one Vercel proxy call.
   */
  async _fetchBatch(symbols, batchIndex) {
    const cfg = MARKET_CONFIG[this.market];

    try {
      const response = await axios.get(`${this.proxyURL}/api/binance-depth`, {
        params: {
          market: this.market,
          symbols: symbols.join(','),
          limit: cfg.depthLimit,
        },
        timeout: BATCH_TIMEOUT,
        headers: { Accept: 'application/json' },
      });

      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.error || error.message;
      console.error(
        `[BinanceProxy:${this.market}] batch ${batchIndex} failed ` +
        `(${symbols.length} syms) — HTTP ${status || 'N/A'}: ${msg}`
      );
      return { books: {}, symbolCount: 0 };
    }
  }

  /**
   * Scan one rotation group of Binance symbols for density walls.
   *
   * Each call scans the NEXT group in the rotation. After all groups
   * have been scanned, it wraps around. This ensures all symbols are
   * covered within the full rotation period while staying within
   * Binance rate limits.
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

      // Step 2: Build/rebuild rotation groups if symbol list changed
      if (!this._groups || this._groupsSymbolCount !== allSymbols.length) {
        this._buildGroups(allSymbols);
      }

      // Step 3: Pick the current group and advance
      const numGroups = this._groups.length;
      const groupIndex = this.currentGroupIndex % numGroups;
      const groupSymbols = this._groups[groupIndex];
      this.currentGroupIndex++;

      // Step 4: Split group into Vercel batches (if group > 150 symbols)
      const batches = [];
      for (let i = 0; i < groupSymbols.length; i += BATCH_SIZE) {
        batches.push(groupSymbols.slice(i, i + BATCH_SIZE));
      }

      // Step 5: Fire all batches in parallel
      const batchResults = await Promise.allSettled(
        batches.map((batch, idx) => this._fetchBatch(batch, idx))
      );

      // Step 6: Merge all books
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
        console.log(`${label} group ${groupIndex}/${numGroups}: 0 books returned`);
        return [];
      }

      // Step 7: Extract walls from each book
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
      const failInfo = failedBatches > 0 ? ` (${failedBatches} batch failures)` : '';
      console.log(
        `${label} ✓ ${allWalls.length} walls from ${totalBookCount}/${groupSymbols.length} books ` +
        `(group ${groupIndex + 1}/${numGroups}) in ${elapsed}ms${failInfo}`
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
