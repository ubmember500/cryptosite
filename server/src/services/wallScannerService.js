const ccxt = require('ccxt');

const SUPPORTED_EXCHANGES = ['binance', 'bybit', 'okx'];

// Lazy-initialized exchange instances
const exchanges = {};

// Market-load promises (one per exchange, resolved once)
const marketPromises = {};

// Top-symbols cache: { [exchangeName]: { data, expiresAt } }
const topSymbolsCache = {};
const TOP_SYMBOLS_TTL = 60 * 60 * 1000; // 1 hour
const MAX_SYMBOLS_PER_EXCHANGE = Number(process.env.WALL_SCANNER_MAX_SYMBOLS ?? 0); // 0 = ALL symbols

// Order-book cache: { [key]: { data, expiresAt } }
const orderBookCache = {};
const ORDER_BOOK_TTL = 60 * 1000; // 60 seconds cache to reduce API calls

/**
 * Get or create a CCXT exchange instance (lazy).
 * Configured for maximum speed with minimal rate limiting.
 */
function getExchange(name) {
  const key = name.toLowerCase();
  if (!SUPPORTED_EXCHANGES.includes(key)) {
    throw new Error(`Unsupported exchange: ${name}`);
  }
  if (!exchanges[key]) {
    exchanges[key] = new ccxt[key]({ 
      enableRateLimit: true,
      rateLimit: 50, // 50ms = 20 requests/second for faster scanning
    });
  }
  return exchanges[key];
}

/**
 * Ensure markets are loaded for an exchange (cached promise).
 */
async function ensureMarkets(exchangeName) {
  const key = exchangeName.toLowerCase();
  if (!marketPromises[key]) {
    const ex = getExchange(key);
    marketPromises[key] = ex.loadMarkets();
  }
  return marketPromises[key];
}

/**
 * Return ALL USDT symbols for an exchange (no filtering).
 * Returns all active USDT pairs sorted alphabetically.
 * @param {string} exchangeName
 * @param {string} market - 'futures' | 'spot' (default: 'futures')
 * Cached for 10 minutes per exchange+market.
 */
async function getTopSymbols(exchangeName, market = 'futures') {
  const exKey = exchangeName.toLowerCase();
  const cacheKey = `${exKey}_${market}`;

  const cached = topSymbolsCache[cacheKey];
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const ex = getExchange(exKey);
  await ensureMarkets(exKey);

  const allMarkets = Object.values(ex.markets);

  // Filter markets by type
  let filtered;
  if (market === 'spot') {
    filtered = allMarkets.filter((m) => {
      const isSpot = m.spot === true;
      const isUSDT = m.quote === 'USDT';
      const isActive = m.active !== false;
      return isSpot && isUSDT && isActive;
    });
  } else {
    filtered = allMarkets.filter((m) => {
      const isSwapOrFuture = m.swap === true || m.future === true;
      const isUSDT = m.settle === 'USDT' || m.quote === 'USDT';
      const isActive = m.active !== false;
      return isSwapOrFuture && isUSDT && isActive;
    });
  }

  let symbols = filtered.map((m) => m.symbol);

  // Sort alphabetically for consistent ordering
  symbols = symbols.sort((a, b) => a.localeCompare(b));

  if (MAX_SYMBOLS_PER_EXCHANGE > 0) {
    symbols = symbols.slice(0, MAX_SYMBOLS_PER_EXCHANGE);
    console.log(`[WallScanner] ${exKey} ${market}: Capped to ${MAX_SYMBOLS_PER_EXCHANGE} symbols`);
  } else {
    console.log(`[WallScanner] ${exKey} ${market}: Scanning ALL ${symbols.length} symbols`);
  }

  // Cache for 10 minutes
  topSymbolsCache[cacheKey] = { 
    data: symbols, 
    expiresAt: Date.now() + 10 * 60 * 1000 
  };
  
  return symbols;
}

/**
 * Fetch order book with 10-second cache.
 */
async function fetchOrderBookCached(exchange, symbol, depth) {
  const cacheKey = `${exchange.id}:${symbol}:${depth}`;
  const cached = orderBookCache[cacheKey];
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const ob = await exchange.fetchOrderBook(symbol, depth);
  orderBookCache[cacheKey] = { data: ob, expiresAt: Date.now() + ORDER_BOOK_TTL };
  return ob;
}

/**
 * Small delay helper to avoid rate limits.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fixed number of order book levels to fetch; filtering by % from mid is done after.
const ORDER_BOOK_FETCH_LIMIT = 100;

/**
 * Group consecutive order book levels whose prices are within
 * `radius * 0.05%` of each other's midpoint. Returns grouped entries
 * where each group's volume is summed and price is volume-weighted.
 * @param {Array} levels - [[price, amount], ...] already filtered by depth
 * @param {number} radius - grouping radius (1 = no grouping)
 * @returns {Array} [{ price, volume, volumeUSD }, ...]
 */
function groupLevelsByRadius(levels, radius) {
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

  const threshold = radius * 0.0005; // radius * 0.05%

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

/**
 * Scan order books with aggressive parallel processing.
 * Scans ALL symbols with maximum parallelization - 80 concurrent requests.
 * @param {Object} params
 * @param {string[]} params.exchanges - exchange names
 * @param {string[]} params.symbols - trading pair symbols
 * @param {number} params.depth - max % from mid (0.5-10)
 * @param {number} params.minVolumeUSD - minimum USD volume to qualify as a wall
 * @param {string} params.side - 'Both' | 'BID' | 'ASK'
 * @param {number} [params.radius=1] - grouping radius (1 = no grouping)
 * @returns {Array} walls sorted by volumeUSD descending
 */
async function scanOrderBooks({ exchanges: exchangeNames, symbols, depth: depthPercent, minVolumeUSD, side, radius = 1 }) {
  const walls = [];
  const depthPercentNum = Math.min(10, Math.max(0.5, Number(depthPercent) || 10));
  const radiusNum = Math.max(1, Math.min(10, Number(radius) || 1));
  
  // Ultra-high concurrency for scanning all tokens (80 concurrent requests)
  const CONCURRENT_LIMIT = 80;

  for (const exName of exchangeNames) {
    let ex;
    try {
      ex = getExchange(exName);
      await ensureMarkets(exName);
    } catch (err) {
      console.error(`[WallScanner] Failed to init exchange ${exName}:`, err.message);
      continue;
    }

    console.log(`[WallScanner] ${exName}: Scanning ${symbols.length} symbols with ${CONCURRENT_LIMIT} concurrent requests...`);
    const startTime = Date.now();

    // Process symbol function
    const processSymbol = async (symbol) => {
      try {
        const ob = await fetchOrderBookCached(ex, symbol, ORDER_BOOK_FETCH_LIMIT);

        if (!ob.bids || !ob.bids.length || !ob.asks || !ob.asks.length) {
          return [];
        }

        const midPrice = (ob.bids[0][0] + ob.asks[0][0]) / 2;
        const timestamp = new Date().toISOString();
        const bidMinPrice = midPrice * (1 - depthPercentNum / 100);
        const askMaxPrice = midPrice * (1 + depthPercentNum / 100);

        const symbolWalls = [];

        if (side === 'Both' || side === 'BID') {
          const filteredBids = ob.bids.filter(([p]) => p >= bidMinPrice);
          const grouped = groupLevelsByRadius(filteredBids, radiusNum);
          
          // Find largest wall for debugging
          let maxBidVol = 0;
          for (const g of grouped) {
            if (g.volumeUSD > maxBidVol) maxBidVol = g.volumeUSD;
            if (g.volumeUSD >= minVolumeUSD) {
              symbolWalls.push({
                timestamp,
                exchange: exName,
                symbol,
                side: 'BID',
                price: g.price,
                volume: g.volume,
                volumeUSD: g.volumeUSD,
                percentFromMid: ((g.price - midPrice) / midPrice * 100).toFixed(3),
              });
            }
          }
          
          // Debug: log if we found a significant wall (even if below threshold)
          if (maxBidVol > minVolumeUSD * 0.5 && symbolWalls.length === 0) {
            console.log(`[WallScanner] ${symbol}: Large BID wall ${maxBidVol.toFixed(0)} USD (below threshold ${minVolumeUSD})`);
          }
        }

        if (side === 'Both' || side === 'ASK') {
          const filteredAsks = ob.asks.filter(([p]) => p <= askMaxPrice);
          const grouped = groupLevelsByRadius(filteredAsks, radiusNum);
          
          // Find largest wall for debugging
          let maxAskVol = 0;
          for (const g of grouped) {
            if (g.volumeUSD > maxAskVol) maxAskVol = g.volumeUSD;
            if (g.volumeUSD >= minVolumeUSD) {
              symbolWalls.push({
                timestamp,
                exchange: exName,
                symbol,
                side: 'ASK',
                price: g.price,
                volume: g.volume,
                volumeUSD: g.volumeUSD,
                percentFromMid: ((g.price - midPrice) / midPrice * 100).toFixed(3),
              });
            }
          }
          
          // Debug: log if we found a significant wall (even if below threshold)
          if (maxAskVol > minVolumeUSD * 0.5 && symbolWalls.length === 0) {
            console.log(`[WallScanner] ${symbol}: Large ASK wall ${maxAskVol.toFixed(0)} USD (below threshold ${minVolumeUSD})`);
          }
        }

        return symbolWalls;
      } catch (err) {
        // Silently skip failed symbols
        return [];
      }
    };

    // Process all symbols with maximum concurrency
    const results = [];
    for (let i = 0; i < symbols.length; i += CONCURRENT_LIMIT) {
      const batch = symbols.slice(i, i + CONCURRENT_LIMIT);
      const batchResults = await Promise.all(batch.map(processSymbol));
      results.push(...batchResults.flat());
      
      // Progress logging every 100 symbols
      if ((i + CONCURRENT_LIMIT) % 100 === 0 || i + CONCURRENT_LIMIT >= symbols.length) {
        const processed = Math.min(i + CONCURRENT_LIMIT, symbols.length);
        console.log(`[WallScanner] ${exName}: Processed ${processed}/${symbols.length} symbols (${((processed/symbols.length)*100).toFixed(0)}%)`);
      }
    }

    walls.push(...results);
    
    const elapsed = Date.now() - startTime;
    const symbolsPerSec = (symbols.length / (elapsed / 1000)).toFixed(1);
    console.log(`[WallScanner] ${exName}: ✓ Completed in ${elapsed}ms (${symbolsPerSec} symbols/sec), found ${results.length} walls`);
  }

  walls.sort((a, b) => b.volumeUSD - a.volumeUSD);
  console.log(`[WallScanner] Total scan complete: ${walls.length} walls found`);
  return walls;
}

/**
 * Build a density map for one exchange+symbol.
 * Only levels within depthPercent of mid are included (max 10%).
 * @param {Object} params
 * @param {string} params.exchange - exchange name
 * @param {string} params.symbol - trading pair
 * @param {number} params.depth - max % from mid (0.5–10)
 * @param {number} [params.minVolumeUSD=0] - minimum USD volume per density bin
 * @returns {{ bids: Array, asks: Array, midPrice: number }}
 */
async function getDensityMap({ exchange: exName, symbol, depth: depthPercent, minVolumeUSD = 0 }) {
  const ex = getExchange(exName);
  await ensureMarkets(exName);

  const ob = await fetchOrderBookCached(ex, symbol, ORDER_BOOK_FETCH_LIMIT);

  if (!ob.bids || !ob.bids.length || !ob.asks || !ob.asks.length) {
    return { bids: [], asks: [], midPrice: 0 };
  }

  const midPrice = (ob.bids[0][0] + ob.asks[0][0]) / 2;
  const depthPercentNum = Math.min(10, Math.max(0.5, Number(depthPercent) || 10));
  const bidMinPrice = midPrice * (1 - depthPercentNum / 100);
  const askMaxPrice = midPrice * (1 + depthPercentNum / 100);

  const TARGET_BINS = 50;
  const minBinVolumeUSD = Math.max(0, Number(minVolumeUSD) || 0);

  function binLevels(levels, priceFilter) {
    if (!levels.length) return [];

    const sliced = levels.filter((l) => priceFilter(l[0]));
    if (!sliced.length) return [];

    const prices = sliced.map((l) => l[0]);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);

    if (minP === maxP) {
      const volumeUSD = sliced.reduce((sum, [p, a]) => sum + p * a, 0);
      return [{ priceLevel: minP, volumeUSD }];
    }

    const binSize = (maxP - minP) / TARGET_BINS;
    const bins = [];

    for (let i = 0; i < TARGET_BINS; i++) {
      const lo = minP + i * binSize;
      const hi = lo + binSize;
      const center = (lo + hi) / 2;
      let volSum = 0;

      for (const [price, amount] of sliced) {
        if (price >= lo && (i === TARGET_BINS - 1 ? price <= hi : price < hi)) {
          volSum += price * amount;
        }
      }

      if (volSum >= minBinVolumeUSD && volSum > 0) {
        bins.push({ priceLevel: parseFloat(center.toPrecision(8)), volumeUSD: volSum });
      }
    }

    return bins;
  }

  return {
    bids: binLevels(ob.bids, (p) => p >= bidMinPrice),
    asks: binLevels(ob.asks, (p) => p <= askMaxPrice),
    midPrice,
  };
}

module.exports = {
  getTopSymbols,
  scanOrderBooks,
  getDensityMap,
  SUPPORTED_EXCHANGES,
};
