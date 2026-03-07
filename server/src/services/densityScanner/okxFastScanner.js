const axios = require('axios');
const { extractWalls, normalizeSymbol, delay } = require('./utils');

const OKX_BASE = 'https://www.okx.com';
const CACHE_TTL = 30000; // 30 seconds
const BATCH_SIZE = 15; // OKX rate limits are strict: 40 req/2s = 20/s
const CTVAL_CACHE_TTL = 10 * 60 * 1000; // Refresh contract values every 10 min

class OkxFastScanner {
  constructor(market = 'futures') {
    this.market = market;
    this.instType = market === 'futures' ? 'SWAP' : 'SPOT';
    this.orderBookCache = new Map();

    // Contract value cache for SWAP instruments.
    // Maps instId (e.g. "BTC-USDT-SWAP") → ctVal (e.g. 0.01).
    // For SWAP: order book size is in CONTRACTS, not base coin.
    // Real quantity = contracts × ctVal. Without this, volumes are wildly wrong
    // (BTC 100× inflated, DOGE 100× deflated).
    this.ctValMap = new Map();
    this.ctValCachedAt = 0;
  }

  /**
   * Fetch contract values (ctVal) for all SWAP instruments.
   * ctVal converts contract count → base coin quantity.
   * E.g. BTC-USDT-SWAP ctVal=0.01 means 1 contract = 0.01 BTC.
   * Cached for 10 minutes — ctVal rarely changes.
   */
  async _fetchContractValues() {
    if (this.instType !== 'SWAP') return; // Spot doesn't need ctVal
    if (this.ctValMap.size > 0 && Date.now() - this.ctValCachedAt < CTVAL_CACHE_TTL) return;

    try {
      const response = await axios.get(`${OKX_BASE}/api/v5/public/instruments`, {
        params: { instType: 'SWAP' },
        timeout: 10000,
      });

      const instruments = response.data?.data || [];
      let count = 0;

      for (const inst of instruments) {
        if (inst.instId && inst.ctVal) {
          this.ctValMap.set(inst.instId, parseFloat(inst.ctVal));
          count++;
        }
      }

      this.ctValCachedAt = Date.now();
      console.log(`[OkxFast:${this.market}] Loaded ctVal for ${count} SWAP instruments`);
    } catch (error) {
      console.error(`[OkxFast:${this.market}] Failed to fetch ctVal: ${error.message}`);
      // Keep using cached values if available
    }
  }

  /**
   * Get all USDT symbols from OKX, sorted by 24h volume descending.
   * Single API call. Filter by USDT pairs only.
   *
   * For SPOT: volCcy24h is in quote currency (USDT) — use directly.
   * For SWAP: volCcy24h is in base currency — multiply by last price for USD.
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
            // SPOT: volCcy24h is in quote currency (USDT) — use directly
            volumeUSD = parseFloat(t.volCcy24h) || 0;
          } else {
            // SWAP: volCcy24h is ALWAYS in base currency (per OKX docs)
            // Multiply by last price to get USD volume
            const volCcy = parseFloat(t.volCcy24h) || 0;
            const last = parseFloat(t.last) || 0;
            volumeUSD = volCcy * last;
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

      // For SWAP: size is in CONTRACTS, not base coin.
      // Multiply by ctVal to get real base-coin quantity.
      // E.g. BTC-USDT-SWAP ctVal=0.01 → 100 contracts = 1 BTC, not 100 BTC.
      const ctVal = this.ctValMap.get(instId) || 1;

      const bids = (bookData.bids || []).map(([price, size]) => [
        parseFloat(price),
        parseFloat(size) * ctVal,
      ]);
      const asks = (bookData.asks || []).map(([price, size]) => [
        parseFloat(price),
        parseFloat(size) * ctVal,
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

    // Load contract values for SWAP instruments (cached 10 min)
    await this._fetchContractValues();

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
