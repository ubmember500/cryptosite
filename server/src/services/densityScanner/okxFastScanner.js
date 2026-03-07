const axios = require('axios');
const { extractWalls, normalizeSymbol, delay } = require('./utils');

const OKX_BASE = 'https://www.okx.com';
const CACHE_TTL = 30000; // 30 seconds
const BATCH_SIZE = 15; // OKX rate limits are strict: 40 req/2s = 20/s

class OkxFastScanner {
  constructor(market = 'futures') {
    this.market = market;
    this.instType = market === 'futures' ? 'SWAP' : 'SPOT';
    this.orderBookCache = new Map();
  }

  /**
   * Get all USDT symbols from OKX, sorted by 24h volume descending.
   * Single API call. Filter by USDT pairs only.
   *
   * For SPOT: instId format is "BTC-USDT", volCcy24h is in USDT.
   * For SWAP: instId format is "BTC-USDT-SWAP", vol24h is in contracts.
   */
  async getAllSymbols(minVolumeUSD = 0) {
    try {
      const response = await axios.get(`${OKX_BASE}/api/v5/market/tickers`, {
        params: { instType: this.instType },
        timeout: 8000,
      });

      const tickers = response.data?.data || [];

      const symbols = tickers
        .filter((t) => {
          if (!t.instId) return false;
          if (this.instType === 'SWAP') {
            return t.instId.includes('-USDT-SWAP');
          }
          // SPOT: ends with -USDT but NOT -USDT-SWAP
          return t.instId.endsWith('-USDT') && !t.instId.includes('-SWAP');
        })
        .map((t) => {
          let volumeUSD;

          if (this.instType === 'SPOT') {
            // volCcy24h is already in quote currency (USDT)
            volumeUSD = parseFloat(t.volCcy24h) || 0;
          } else {
            // SWAP: volCcy24h can be in base currency
            // Use volCcy24h * last as a rough USDT estimate
            const volCcy = parseFloat(t.volCcy24h) || 0;
            const last = parseFloat(t.last) || 0;

            // If volCcy24h seems unreasonably small (likely base coin), multiply by last
            if (volCcy > 0 && last > 0 && volCcy < 1000 && last > 100) {
              volumeUSD = volCcy * last;
            } else if (volCcy > 0) {
              // Likely already in USDT or large enough to use directly
              volumeUSD = volCcy;
            } else {
              // Fallback: vol24h (contracts) * last
              volumeUSD = (parseFloat(t.vol24h) || 0) * last;
            }
          }

          return {
            symbol: t.instId,
            volumeUSD,
          };
        })
        .filter((s) => s.volumeUSD >= minVolumeUSD)
        .sort((a, b) => b.volumeUSD - a.volumeUSD);

      console.log(
        `[OkxFast] Found ${symbols.length} symbols with volume >= ${minVolumeUSD} USD`
      );

      return symbols;
    } catch (error) {
      console.error(`[OkxFast] Failed to fetch tickers: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch order book for a single instrument with 30s cache.
   * Returns { bids: [[price, amount], ...], asks: [[price, amount], ...] }
   * OKX levels are 4-element arrays: [price, size, deprecated, numOrders]
   * We only use the first two elements.
   */
  async fetchOrderBook(instId, limit = 400) {
    const cacheKey = `${instId}_${limit}`;
    const cached = this.orderBookCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await axios.get(`${OKX_BASE}/api/v5/market/books`, {
        params: {
          instId,
          sz: limit,
        },
        timeout: 5000,
      });

      const bookData = response.data?.data?.[0] || {};
      const bids = (bookData.bids || []).map(([price, size]) => [
        parseFloat(price),
        parseFloat(size),
      ]);
      const asks = (bookData.asks || []).map(([price, size]) => [
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
   *   2) Fetch order books in batches of 15 (OKX strict rate limits)
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
      console.log('[OkxFast] No symbols to scan');
      return [];
    }

    console.log(`[OkxFast] Scanning ${symbols.length} symbols...`);

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
              exchange: 'okx',
              symbol: normalizeSymbol(rawSymbol, 'okx').normalized,
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
        `[OkxFast] Progress: ${processed}/${symbols.length} (${pct}%)`
      );

      // 150ms delay between batches to stay within OKX rate limits
      if (i + BATCH_SIZE < symbols.length) {
        await delay(150);
      }
    }

    allWalls.sort((a, b) => (b.volumeUSD || 0) - (a.volumeUSD || 0));

    const elapsed = Date.now() - startTime;
    console.log(
      `[OkxFast] Scan complete in ${elapsed}ms, found ${allWalls.length} walls`
    );

    return allWalls;
  }
}

module.exports = { OkxFastScanner };
