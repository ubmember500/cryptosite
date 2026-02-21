const axios = require('axios');

const BYBIT_BASE_URL = 'https://api.bybit.com';

// category: spot | linear (USDT perpetual futures)
const CACHE_TTL = 300000; // 5 minutes
const cache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const klinesCache = {};
const KLINES_CACHE_TTL = 300000;

// Alert engine: last prices cache (short TTL, same as Binance)
const lastPricesCache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const LAST_PRICES_CACHE_TTL = 2000; // 2 seconds

// Active symbols cache for "all coins" complex alerts
const activeSymbolsCache = {
  futures: { symbols: null, timestamp: null },
  spot: { symbols: null, timestamp: null },
};
const ACTIVE_SYMBOLS_CACHE_TTL = 3600000; // 1 hour

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize symbol to Bybit format (same as Binance: uppercase, no separators).
 * e.g. "btc/usdt" -> "BTCUSDT"
 */
function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Get last price per symbol from Bybit tickers (for alert engine).
 * Same interface as binanceService.getLastPricesBySymbols.
 * @param {string[]} symbols - e.g. ["BTCUSDT"] or [] for full map
 * @param {'futures'|'spot'} exchangeType - market (linear vs spot)
 * @returns {Promise<Record<string, number>>} symbol -> lastPrice
 */
async function getLastPricesBySymbols(symbols, exchangeType, options = {}) {
  const { strict = false } = options;
  const cacheKey = exchangeType === 'futures' ? 'futures' : 'spot';
  const now = Date.now();
  if (
    lastPricesCache[cacheKey].data &&
    lastPricesCache[cacheKey].timestamp &&
    now - lastPricesCache[cacheKey].timestamp < LAST_PRICES_CACHE_TTL
  ) {
    const cached = lastPricesCache[cacheKey].data;
    if (!symbols || symbols.length === 0) return cached;
    const out = {};
    const wanted = new Set(symbols);
    for (const sym of wanted) {
      if (typeof sym !== 'string') continue;
      const exact = sym;
      let price = cached[exact];
      if (price == null) {
        const upper = exact.toUpperCase();
        if (upper !== exact) price = cached[upper];
      }
      if (price != null) out[sym] = price;
    }
    return out;
  }

  try {
    const tokens = await fetchTickers(exchangeType);
    const fullMap = {};
    for (const t of tokens) {
      if (t.fullSymbol && t.lastPrice != null && Number.isFinite(t.lastPrice) && t.lastPrice > 0) {
        fullMap[t.fullSymbol] = t.lastPrice;
      }
    }
    lastPricesCache[cacheKey].data = fullMap;
    lastPricesCache[cacheKey].timestamp = now;

    if (!symbols || symbols.length === 0) return fullMap;
    const wanted = new Set(symbols);
    const out = {};
    for (const sym of wanted) {
      if (typeof sym !== 'string') continue;
      const exact = sym;
      let price = fullMap[exact];
      if (price == null) {
        const upper = exact.toUpperCase();
        if (upper !== exact) price = fullMap[upper];
      }
      if (price != null) out[sym] = price;
    }
    return out;
  } catch (error) {
    console.warn(`[Bybit getLastPricesBySymbols] ${exchangeType} failed:`, error.message);
    if (strict && Array.isArray(symbols) && symbols.length > 0) {
      const upstreamError = new Error(`Bybit ${exchangeType} price feed unavailable: ${error.message}`);
      upstreamError.statusCode = error?.statusCode || error?.response?.status || 503;
      upstreamError.code = 'UPSTREAM_PRICE_UNAVAILABLE';
      throw upstreamError;
    }
    return {};
  }
}

/**
 * Fetch active USDT symbol set for "all coins" complex alerts (same as Binance).
 * @param {'futures'|'spot'} exchangeType
 * @returns {Promise<Set<string>|null>}
 */
async function fetchActiveSymbols(exchangeType) {
  const cacheKey = exchangeType;
  const now = Date.now();
  if (
    activeSymbolsCache[cacheKey].symbols &&
    activeSymbolsCache[cacheKey].timestamp &&
    now - activeSymbolsCache[cacheKey].timestamp < ACTIVE_SYMBOLS_CACHE_TTL
  ) {
    return activeSymbolsCache[cacheKey].symbols;
  }
  try {
    const tokens = await fetchTickers(exchangeType);
    const symbols = new Set(
      tokens.filter((t) => t.fullSymbol && t.fullSymbol.endsWith('USDT')).map((t) => t.fullSymbol)
    );
    activeSymbolsCache[cacheKey].symbols = symbols;
    activeSymbolsCache[cacheKey].timestamp = now;
    console.log(`[Bybit ${exchangeType.toUpperCase()}] Active USDT symbols: ${symbols.size}`);
    return symbols;
  } catch (error) {
    console.warn(`[Bybit] fetchActiveSymbols failed:`, error.message);
    return null;
  }
}

/**
 * Calculate NATR approximation from 24h high/low/lastPrice (same as Binance)
 */
function calculateInstantNATR(token) {
  if (
    token.high24h == null ||
    token.low24h == null ||
    token.lastPrice == null ||
    token.lastPrice === 0
  ) {
    return null;
  }
  const trueRange = token.high24h - token.low24h;
  const natr = (trueRange / token.lastPrice) * 100;
  return parseFloat(natr.toFixed(2));
}

/**
 * Map our interval to Bybit interval
 * Bybit: 1,3,5,15,30,60,120,240,360,720,D,W,M (minutes or D/W/M)
 */
function mapIntervalToBybit(interval) {
  const map = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
  };
  return map[interval] || '15';
}

/**
 * Fetch all tickers for a category (spot or linear), filter USDT, add NATR
 * Bybit: GET /v5/market/tickers?category=spot|linear
 * Response: result.list[] with lastPrice, prevPrice24h, price24hPcnt, highPrice24h, lowPrice24h, turnover24h, volume24h
 */
async function fetchTickers(exchangeType, retries = 3) {
  const category = exchangeType === 'futures' ? 'linear' : 'spot';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${BYBIT_BASE_URL}/v5/market/tickers`, {
        params: { category },
        timeout: 15000,
      });

      if (response.data?.retCode !== 0) {
        throw new Error(response.data?.retMsg || 'Bybit API error');
      }

      const list = response.data?.result?.list || [];
      const isFutures = exchangeType === 'futures';

      const tokens = list
        .filter((t) => {
          if (!t.symbol) return false;
          if (isFutures) return true; // linear = all USDT perpetual
          return t.symbol.endsWith('USDT');
        })
        .map((t) => {
          const lastPrice = parseFloat(t.lastPrice);
          const high24h = parseFloat(t.highPrice24h);
          const low24h = parseFloat(t.lowPrice24h);
          const price24hPcnt = parseFloat(t.price24hPcnt);
          const volume24h = parseFloat(t.volume24h);
          const turnover24h = parseFloat(t.turnover24h);

          const token = {
            symbol: t.symbol.replace('USDT', ''),
            fullSymbol: t.symbol,
            lastPrice: Number.isFinite(lastPrice) ? lastPrice : null,
            volume24h: Number.isFinite(turnover24h) ? turnover24h : (Number.isFinite(volume24h) ? volume24h : null),
            priceChangePercent24h: Number.isFinite(price24hPcnt) ? price24hPcnt * 100 : null,
            high24h: Number.isFinite(high24h) ? high24h : null,
            low24h: Number.isFinite(low24h) ? low24h : null,
          };
          token.natr = calculateInstantNATR(token);
          return token;
        });

      console.log(`[Bybit ${exchangeType.toUpperCase()}] Fetched ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[Bybit] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[Bybit] Error fetching tickers:', error.message);
      throw new Error(error.response?.data?.retMsg || error.message || 'Failed to fetch Bybit tokens');
    }
  }
}

/**
 * Fetch tokens with NATR (cached). Same interface as binanceService.fetchTokensWithNATR
 * @param {'futures'|'spot'} exchangeType
 * @param {{ forceFresh?: boolean }} options
 */
async function fetchTokensWithNATR(exchangeType, options = {}) {
  const { forceFresh = false } = options;
  const cacheKey = exchangeType;
  const now = Date.now();

  if (
    !forceFresh &&
    cache[cacheKey].data &&
    cache[cacheKey].timestamp &&
    now - cache[cacheKey].timestamp < CACHE_TTL
  ) {
    return cache[cacheKey].data;
  }

  if (forceFresh) {
    activeSymbolsCache[cacheKey].symbols = null;
    activeSymbolsCache[cacheKey].timestamp = null;
  }

  const tokens = await fetchTickers(exchangeType);
  cache[cacheKey].data = tokens;
  cache[cacheKey].timestamp = now;
  return tokens;
}

/**
 * Resample 1m klines to second intervals (same as Binance)
 */
function resample1mToSeconds(klines1m, secondInterval) {
  const spanSeconds = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  const subPerMinute = 60 / spanSeconds;
  const result = [];
  for (const k of klines1m) {
    const openTimeSec = k.time;
    const volumePerSub = k.volume / subPerMinute;
    for (let i = 0; i < subPerMinute; i++) {
      result.push({
        time: openTimeSec + i * spanSeconds,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: volumePerSub,
      });
    }
  }
  return result;
}

/**
 * Fetch klines from Bybit. Same output shape as Binance: { time, open, high, low, close, volume }, time in seconds
 * Bybit returns list of [startTimeMs, open, high, low, close, volume, turnover], newest first
 */
async function fetchKlines(symbol, exchangeType, interval = '15m', limit = 500, options = {}) {
  const { retries = 1, before = null } = options || {};
  const validIntervals = ['1s', '5s', '15s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];
  if (!validIntervals.includes(interval)) {
    throw new Error(`Invalid interval. Must be one of: ${validIntervals.join(', ')}`);
  }
  if (limit < 1 || limit > 1000) {
    throw new Error('Limit must be between 1 and 1000');
  }
  if (!['futures', 'spot'].includes(exchangeType)) {
    throw new Error('Invalid exchangeType. Must be "futures" or "spot"');
  }

  const category = exchangeType === 'futures' ? 'linear' : 'spot';
  const hasBefore = before !== null && before !== undefined && before !== '' && Number.isFinite(Number(before)) && Number(before) > 0;
  const beforeKey = hasBefore ? String(Math.floor(Number(before))) : 'latest';
  const cacheKey = `bybit_${symbol}_${exchangeType}_${interval}_${limit}_${beforeKey}`;
  const now = Date.now();
  if (klinesCache[cacheKey]?.timestamp && now - klinesCache[cacheKey].timestamp < KLINES_CACHE_TTL) {
    return klinesCache[cacheKey].data;
  }

  const isSecondInterval = ['1s', '5s', '15s'].includes(interval);
  const bybitInterval = isSecondInterval ? '1' : mapIntervalToBybit(interval);
  const bybitLimit = isSecondInterval ? { '1s': 50, '5s': 84, '15s': 125 }[interval] : limit;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${BYBIT_BASE_URL}/v5/market/kline`, {
        params: {
          category,
          symbol: symbol.toUpperCase(),
          interval: bybitInterval,
          limit: bybitLimit,
          ...(hasBefore ? { end: Math.floor(Number(before)) - 1 } : {}),
        },
        timeout: 10000,
      });

      if (response.data?.retCode !== 0) {
        throw new Error(response.data?.retMsg || 'Bybit API error');
      }

      const rawList = response.data?.result?.list || [];
      const klines = rawList.map((arr, index) => {
        const startTimeMs = parseInt(arr[0], 10);
        const time = Math.floor(startTimeMs / 1000);
        const open = parseFloat(arr[1]);
        const high = parseFloat(arr[2]);
        const low = parseFloat(arr[3]);
        const close = parseFloat(arr[4]);
        const volume = parseFloat(arr[5]) || 0;
        if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
          throw new Error(`Invalid kline at index ${index}`);
        }
        return { time, open, high, low, close, volume };
      });

      // Bybit returns newest first; we need chronological order
      klines.reverse();

      const finalKlines = isSecondInterval ? resample1mToSeconds(klines, interval) : klines;
      klinesCache[cacheKey] = { data: finalKlines, timestamp: now };
      console.log(`[Bybit] Fetched ${finalKlines.length} klines for ${symbol} (${interval})`);
      return finalKlines;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        await wait(Math.pow(2, attempt) * 500);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 500);
        continue;
      }
      throw new Error(error.response?.data?.retMsg || error.message || `Failed to fetch Bybit klines for ${symbol}`);
    }
  }
}

/**
 * Fetch single token details (same as Binance fetchTokenWithNATR)
 */
async function fetchTokenWithNATR(symbol, exchangeType) {
  const tokens = await fetchTokensWithNATR(exchangeType);
  const token = tokens.find((t) => t.fullSymbol === symbol.toUpperCase());
  if (!token) throw new Error(`Token ${symbol} not found on Bybit`);
  return token;
}

module.exports = {
  fetchTokensWithNATR,
  fetchTokenWithNATR,
  fetchKlines,
  calculateInstantNATR,
  normalizeSymbol,
  getLastPricesBySymbols,
  fetchActiveSymbols,
};
