/**
 * BinanceProxyScanner — Fetches Binance order books via Vercel proxy.
 *
 * Binance blocks cloud-provider IPs (Render/AWS) on both REST and WebSocket.
 * This scanner routes requests through a Vercel serverless function that
 * acts as a proxy: Vercel → Binance → Vercel → This scanner.
 *
 * The Vercel function (`/api/binance-depth`) fetches top symbols by volume
 * and their order books in one call. This scanner receives all the data,
 * passes each book through extractWalls(), and returns walls.
 *
 * Symbol caching:
 *   On first call, the Vercel function discovers top symbols by volume
 *   (live ticker fetch with fallback). The returned symbol list is cached
 *   and passed on subsequent calls via the `symbols` query param, which
 *   skips the ticker fetch entirely — making it fast and reliable within
 *   Vercel's 10s function timeout. Cache refreshes every 5 minutes.
 *
 * @module densityScanner/binanceProxyScanner
 */

const axios = require('axios');
const { extractWalls, normalizeSymbol } = require('./utils');

const DEFAULT_PROXY_URL = 'https://cryptosite2027.vercel.app';
const SYMBOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
   * Scan for density walls by fetching all order books from the Vercel proxy.
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
      // Build params — pass cached symbols if available (skips ticker fetch)
      const params = {
        market: this.market,
        top: 30,
        limit: 20,
      };

      const cacheExpired = Date.now() - this.symbolsCachedAt > SYMBOL_CACHE_TTL;

      if (this.cachedSymbols && !cacheExpired) {
        params.symbols = this.cachedSymbols.join(',');
      }

      const response = await axios.get(`${this.proxyURL}/api/binance-depth`, {
        params,
        timeout: 15000,
        headers: { Accept: 'application/json' },
      });

      const { books, symbolCount, symbols, symbolSource } = response.data;

      // Cache the symbol list returned by the Vercel function
      if (symbols && symbols.length > 0) {
        this.cachedSymbols = symbols;
        this.symbolsCachedAt = Date.now();
      }

      if (!books || symbolCount === 0) {
        console.log(`${label} proxy returned 0 books (source: ${symbolSource})`);
        return [];
      }

      // Process each order book through extractWalls()
      const allWalls = [];

      for (const [symbol, rawBook] of Object.entries(books)) {
        const bids = (rawBook.bids || []).map(([p, q]) => [
          parseFloat(p),
          parseFloat(q),
        ]);
        const asks = (rawBook.asks || []).map(([p, q]) => [
          parseFloat(p),
          parseFloat(q),
        ]);

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
      console.log(
        `${label} ✓ ${allWalls.length} walls from ${symbolCount} books in ${elapsed}ms (${symbolSource})`
      );

      return allWalls;
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.error || error.message;
      console.error(`${label} proxy error — HTTP ${status || 'N/A'}: ${msg}`);
      return [];
    }
  }
}

module.exports = { BinanceProxyScanner };
