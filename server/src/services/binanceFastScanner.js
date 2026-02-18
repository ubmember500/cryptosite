const axios = require('axios');

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const BINANCE_SPOT_BASE = 'https://api.binance.com';

// Cache for order books
const orderBookCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

/**
 * Fast scanner using native Binance API (10x faster than CCXT)
 */
class BinanceFastScanner {
  constructor(market = 'futures') {
    this.baseURL = market === 'futures' ? BINANCE_FUTURES_BASE : BINANCE_SPOT_BASE;
    this.market = market;
  }

  /**
   * Get ALL symbols with volume filtering in a single request
   */
  async getAllSymbolsWithVolume(minVolumeUSD = 0) {
    try {
      const endpoint = this.market === 'futures' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';
      const response = await axios.get(`${this.baseURL}${endpoint}`, { timeout: 10000 });
      
      const tickers = response.data;
      
      // Filter USDT pairs with volume
      const filtered = tickers
        .filter(t => {
          const symbol = t.symbol;
          const isUSDT = symbol.endsWith('USDT');
          const volume = parseFloat(t.quoteVolume || 0);
          return isUSDT && volume >= minVolumeUSD;
        })
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .map(t => t.symbol);

      console.log(`[BinanceFast] Found ${filtered.length} symbols with volume >=${minVolumeUSD} USD`);
      return filtered;
    } catch (error) {
      console.error('[BinanceFast] Failed to fetch symbols:', error.message);
      return [];
    }
  }

  /**
   * Fetch order book with caching
   */
  async fetchOrderBook(symbol, limit = 100) {
    const cacheKey = `${symbol}:${limit}`;
    const cached = orderBookCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      const endpoint = this.market === 'futures' ? '/fapi/v1/depth' : '/api/v3/depth';
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        params: { symbol, limit },
        timeout: 5000,
      });

      const data = {
        bids: response.data.bids.map(([price, amount]) => [parseFloat(price), parseFloat(amount)]),
        asks: response.data.asks.map(([price, amount]) => [parseFloat(price), parseFloat(amount)]),
      };

      orderBookCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      // Silent fail for individual symbols
      return { bids: [], asks: [] };
    }
  }

  /**
   * Scan all symbols for walls with ultra-high concurrency
   */
  async scanForWalls({ minVolumeUSD = 5000000, minWallSize = 350000, depth = 10, radius = 1 }) {
    const startTime = Date.now();
    
    // Step 1: Get all symbols with volume filter (single request)
    const symbols = await this.getAllSymbolsWithVolume(minVolumeUSD);
    console.log(`[BinanceFast] Scanning ${symbols.length} symbols...`);

    // Step 2: Scan order books with ultra-high concurrency (200 parallel)
    const BATCH_SIZE = 200;
    const walls = [];
    
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(symbol => this.scanSymbol(symbol, minWallSize, depth, radius));
      
      const results = await Promise.all(batchPromises);
      walls.push(...results.flat());
      
      const progress = Math.min(i + BATCH_SIZE, symbols.length);
      console.log(`[BinanceFast] Progress: ${progress}/${symbols.length} (${((progress/symbols.length)*100).toFixed(0)}%)`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[BinanceFast] Scan complete in ${elapsed}ms, found ${walls.length} walls`);

    return walls.sort((a, b) => b.volumeUSD - a.volumeUSD);
  }

  /**
   * Scan a single symbol for walls
   */
  async scanSymbol(symbol, minWallSize, depthPercent, radius) {
    try {
      const ob = await this.fetchOrderBook(symbol, 100);
      
      if (!ob.bids.length || !ob.asks.length) return [];

      const midPrice = (ob.bids[0][0] + ob.asks[0][0]) / 2;
      const bidMinPrice = midPrice * (1 - depthPercent / 100);
      const askMaxPrice = midPrice * (1 + depthPercent / 100);
      
      const walls = [];
      const timestamp = new Date().toISOString();

      // Scan bids
      const filteredBids = ob.bids.filter(([p]) => p >= bidMinPrice);
      const groupedBids = this.groupLevels(filteredBids, radius);
      
      for (const group of groupedBids) {
        if (group.volumeUSD >= minWallSize) {
          walls.push({
            timestamp,
            exchange: 'binance',
            symbol,
            side: 'BID',
            price: group.price,
            volume: group.volume,
            volumeUSD: group.volumeUSD,
            percentFromMid: ((group.price - midPrice) / midPrice * 100).toFixed(3),
          });
        }
      }

      // Scan asks
      const filteredAsks = ob.asks.filter(([p]) => p <= askMaxPrice);
      const groupedAsks = this.groupLevels(filteredAsks, radius);
      
      for (const group of groupedAsks) {
        if (group.volumeUSD >= minWallSize) {
          walls.push({
            timestamp,
            exchange: 'binance',
            symbol,
            side: 'ASK',
            price: group.price,
            volume: group.volume,
            volumeUSD: group.volumeUSD,
            percentFromMid: ((group.price - midPrice) / midPrice * 100).toFixed(3),
          });
        }
      }

      return walls;
    } catch (error) {
      return [];
    }
  }

  /**
   * Group order book levels by radius
   */
  groupLevels(levels, radius) {
    if (!levels.length) return [];
    if (radius <= 1) {
      return levels.map(([price, amount]) => ({
        price,
        volume: amount,
        volumeUSD: price * amount,
      }));
    }

    const groups = [];
    let groupPriceSum = levels[0][0] * (levels[0][0] * levels[0][1]);
    let groupVolUSD = levels[0][0] * levels[0][1];
    let groupVol = levels[0][1];
    let groupAnchor = levels[0][0];
    const threshold = radius * 0.0005;

    for (let i = 1; i < levels.length; i++) {
      const [price, amount] = levels[i];
      const priceDiff = Math.abs(price - groupAnchor) / groupAnchor;

      if (priceDiff <= threshold) {
        const usd = price * amount;
        groupPriceSum += price * usd;
        groupVolUSD += usd;
        groupVol += amount;
      } else {
        groups.push({
          price: groupVolUSD > 0 ? groupPriceSum / groupVolUSD : groupAnchor,
          volume: groupVol,
          volumeUSD: groupVolUSD,
        });
        groupPriceSum = price * (price * amount);
        groupVolUSD = price * amount;
        groupVol = amount;
        groupAnchor = price;
      }
    }

    groups.push({
      price: groupVolUSD > 0 ? groupPriceSum / groupVolUSD : groupAnchor,
      volume: groupVol,
      volumeUSD: groupVolUSD,
    });

    return groups;
  }
}

module.exports = { BinanceFastScanner };
