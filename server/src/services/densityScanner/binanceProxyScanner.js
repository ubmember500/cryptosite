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
 * Advantages:
 *   - Works regardless of server IP restrictions
 *   - One HTTP call per scan cycle (all books batched)
 *   - No WebSocket management, no reconnection, no ping/pong
 *   - Vercel function proven to reach Binance (used by chart klines)
 *
 * @module densityScanner/binanceProxyScanner
 */

const axios = require('axios');
const { extractWalls, normalizeSymbol } = require('./utils');

// The Vercel-hosted client has the proxy function.
// In production this is the live Vercel deployment.
const DEFAULT_PROXY_URL = 'https://cryptosite2027.vercel.app';

class BinanceProxyScanner {
  /**
   * @param {'futures'|'spot'} market
   */
  constructor(market = 'futures') {
    this.market = market;
    this.proxyURL = process.env.VERCEL_PROXY_URL || DEFAULT_PROXY_URL;
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
    const label = `[BinanceProxy] ${this.market}`;

    try {
      // One call to Vercel: fetches tickers + depth for top 40 symbols
      const response = await axios.get(`${this.proxyURL}/api/binance-depth`, {
        params: {
          market: this.market,
          top: 40,
          limit: 20,
        },
        timeout: 25000, // generous timeout: Vercel function itself has a budget
        headers: {
          'Accept': 'application/json',
        },
      });

      const { books, symbolCount } = response.data;

      if (!books || symbolCount === 0) {
        console.log(`${label}: proxy returned 0 books`);
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
        `${label}: ✓ ${allWalls.length} walls from ${symbolCount} books in ${elapsed}ms`
      );

      return allWalls;
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.error || error.message;
      console.error(`${label}: proxy error — HTTP ${status || 'N/A'}: ${msg}`);
      return [];
    }
  }
}

module.exports = { BinanceProxyScanner };
