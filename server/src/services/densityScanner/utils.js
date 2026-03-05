/**
 * Density Scanner — Shared Utilities
 *
 * Provides common helper functions used across all exchange-specific density
 * scanners (Binance, Bybit, OKX, etc.):
 *
 *  - groupLevels()      – aggregate nearby order-book price levels
 *  - normalizeSymbol()   – unify exchange symbol formats to BASEUSDT
 *  - extractWalls()      – detect bid/ask walls from a raw order book
 *  - formatDuration()    – human-readable elapsed time strings
 *  - delay()             – promise-based sleep helper
 *
 * @module densityScanner/utils
 */

// ---------------------------------------------------------------------------
// groupLevels
// ---------------------------------------------------------------------------

/**
 * Groups consecutive order-book levels whose prices fall within
 * `radius * 0.05 %` of the group anchor price.
 *
 * @param {Array<[number, number]>} levels  – [[price, amount], …]
 * @param {number}                  radius  – grouping radius (1 = no grouping)
 * @returns {Array<{price: number, volume: number, volumeUSD: number}>}
 *          Volume-weighted grouped levels.
 */
function groupLevels(levels, radius) {
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

// ---------------------------------------------------------------------------
// normalizeSymbol
// ---------------------------------------------------------------------------

/**
 * Converts an exchange-specific symbol to a unified `BASEUSDT` format.
 *
 * Supported conversions:
 *  - OKX futures  : `BTC-USDT-SWAP` → `BTCUSDT`
 *  - OKX spot     : `BTC-USDT`      → `BTCUSDT`
 *  - Bybit / Binance : already `BTCUSDT`
 *
 * @param {string} symbol   – raw symbol from the exchange
 * @param {string} exchange – exchange identifier (e.g. 'okx', 'bybit', 'binance')
 * @returns {{ normalized: string, original: string }}
 */
function normalizeSymbol(symbol, exchange) {
  const original = symbol;
  let normalized = symbol;

  const ex = (exchange || '').toLowerCase();

  if (ex === 'okx') {
    // BTC-USDT-SWAP → BTCUSDT, BTC-USDT → BTCUSDT
    normalized = symbol.replace(/-SWAP$/i, '').replace(/-/g, '');
  }
  // Bybit & Binance symbols are already in BASEUSDT format

  return { normalized, original };
}

// ---------------------------------------------------------------------------
// extractWalls
// ---------------------------------------------------------------------------

/**
 * Detects large bid/ask walls from a raw order book.
 *
 * @param {{ bids: Array<[number, number]>, asks: Array<[number, number]> }} orderBook
 * @param {object}  opts
 * @param {string}  opts.exchange       – exchange name
 * @param {string}  opts.symbol         – normalized symbol
 * @param {string}  opts.originalSymbol – original exchange symbol
 * @param {number}  opts.depthPercent   – max distance from mid-price (%)
 * @param {number}  opts.minWallSize    – minimum volumeUSD to qualify as a wall
 * @param {number}  opts.radius         – grouping radius passed to groupLevels()
 * @param {string}  opts.market         – market type (e.g. 'spot', 'futures')
 * @returns {Array<object>} wall objects
 */
function extractWalls(
  orderBook,
  { exchange, symbol, originalSymbol, depthPercent, minWallSize, radius, market },
) {
  const { bids = [], asks = [] } = orderBook;

  if (!bids.length || !asks.length) return [];

  const bestBid = bids[0][0];
  const bestAsk = asks[0][0];
  const midPrice = (bestBid + bestAsk) / 2;

  if (!midPrice || midPrice <= 0) return [];

  const depthFraction = depthPercent / 100;

  // Filter levels within depth range
  const filteredBids = bids.filter(
    ([price]) => price >= midPrice * (1 - depthFraction),
  );
  const filteredAsks = asks.filter(
    ([price]) => price <= midPrice * (1 + depthFraction),
  );

  // Group nearby levels
  const groupedBids = groupLevels(filteredBids, radius);
  const groupedAsks = groupLevels(filteredAsks, radius);

  const walls = [];

  for (const g of groupedBids) {
    if (g.volumeUSD >= minWallSize) {
      walls.push({
        exchange,
        symbol,
        originalSymbol,
        market,
        side: 'BID',
        price: g.price,
        volume: g.volume,
        volumeUSD: g.volumeUSD,
        percentFromMid: ((g.price - midPrice) / midPrice) * 100,
        midPrice,
      });
    }
  }

  for (const g of groupedAsks) {
    if (g.volumeUSD >= minWallSize) {
      walls.push({
        exchange,
        symbol,
        originalSymbol,
        market,
        side: 'ASK',
        price: g.price,
        volume: g.volume,
        volumeUSD: g.volumeUSD,
        percentFromMid: ((g.price - midPrice) / midPrice) * 100,
        midPrice,
      });
    }
  }

  return walls;
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

/**
 * Converts milliseconds to a human-readable duration string.
 *
 * Examples: `"3m"`, `"1h 25m"`, `"2d 5h"`
 *
 * @param {number} ms – duration in milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 0) ms = 0;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

/**
 * Promise-based delay / sleep helper.
 *
 * @param {number} ms – milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  groupLevels,
  normalizeSymbol,
  extractWalls,
  formatDuration,
  delay,
};
