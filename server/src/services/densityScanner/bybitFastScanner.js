const axios = require('axios');
const { extractWalls, normalizeSymbol, delay } = require('./utils');

const BYBIT_BASE = 'https://api.bybit.com';
const CACHE_TTL = 30000; // 30 seconds
const BATCH_SIZE = 80;

class BybitFastScanner {
  constructor(market = 'futures') {
    this.market = market;
    this.category = market === 'futures' ? 'linear' : 'spot';
    this.orderBookCache = new Map();
  }

  /**
   * Get all USDT symbols from Bybit, sorted by 24h volume descending.
   * Single API call. Filter by USDT suffix and optional minVolumeUSD.
   */
  async getAllSymbols(minVolumeUSD = 0) {
    try {
      const response = await axios.get(`${BYBIT_BASE}/v5/market/tickers`, {
        params: { category: this.category },
        timeout: 8000,
      });

      const tickers = response.data?.result?.list || [];

      const symbols = tickers
        .filter((t) => t.symbol && t.symbol.endsWith('USDT'))
        .map((t) => ({
          symbol: t.symbol,
          volumeUSD: parseFloat(t.turnover24h) || 0,
        }))
        .filter((s) => s.volumeUSD >= minVolumeUSD)
        .sort((a, b) => b.volumeUSD - a.volumeUSD);

      console.log(
        `[BybitFast] Found ${symbols.length} symbols with volume >= ${minVolumeUSD} USD`
      );

      return symbols;
    } catch (error) {
      console.error(`[BybitFast] Failed to fetch tickers: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch order book for a single symbol with 30s cache.
   * Returns { bids: [[price, amount], ...], asks: [[price, amount], ...] }
   * Parses string values to floats.
   */
  async fetchOrderBook(symbol, limit = 50) {
    const cacheKey = `${symbol}_${limit}`;
    const cached = this.orderBookCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await axios.get(`${BYBIT_BASE}/v5/market/orderbook`, {
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
   *   1) Get all symbols
   *   2) Fetch order books in batches of 80
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

    const symbols = await this.getAllSymbols(minVolumeUSD);
    if (symbols.length === 0) {
      console.log('[BybitFast] No symbols to scan');
      return [];
    }

    console.log(`[BybitFast] Scanning ${symbols.length} symbols...`);

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
        `[BybitFast] Progress: ${processed}/${symbols.length} (${pct}%)`
      );

      // Small delay between batches to stay within rate limits
      if (i + BATCH_SIZE < symbols.length) {
        await delay(100);
      }
    }

    allWalls.sort((a, b) => (b.volumeUSD || 0) - (a.volumeUSD || 0));

    const elapsed = Date.now() - startTime;
    console.log(
      `[BybitFast] Scan complete in ${elapsed}ms, found ${allWalls.length} walls`
    );

    return allWalls;
  }
}

module.exports = { BybitFastScanner };
