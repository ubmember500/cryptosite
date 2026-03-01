const axios = require('axios');

const MEXC_BASE_URL = 'https://api.mexc.com';

const CACHE_TTL = 300000; // 5 minutes
const cache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const klinesCache = {};
const KLINES_CACHE_TTL = 300000;

// Alert engine: last prices cache (short TTL, same as other exchanges)
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
 * Normalize symbol to our format (uppercase, no separators) – same as Binance/Bybit/OKX/Gate.
 * e.g. "btc_usdt" -> "BTCUSDT"
 */
function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  const raw = symbol.trim().toUpperCase();
  if (!raw) return '';

  let normalized = raw
    .replace(/\.P$/i, '')
    .replace(/-PERP(ETUAL)?$/i, '')
    .replace(/PERP$/i, '')
    .replace(/-SWAP$/i, '')
    .replace(/_PERP(ETUAL)?$/i, '')
    .replace(/USDTM$/i, 'USDT');

  if (normalized.includes('-') || normalized.includes('_') || normalized.includes('/')) {
    const parts = normalized
      .replace(/[_/]/g, '-')
      .split('-')
      .filter(Boolean);
    if (parts.length >= 2 && (parts[1] === 'USDT' || parts[1] === 'USD')) {
      normalized = `${parts[0]}${parts[1]}`;
    } else {
      normalized = parts.join('');
    }
  }

  return normalized.replace(/[^A-Z0-9]/g, '');
}

/**
 * Get last price per symbol from MEXC tickers (for alert engine).
 * Same interface as binanceService.getLastPricesBySymbols. Keys are fullSymbol (e.g. BTCUSDT).
 * @param {string[]} symbols - e.g. ["BTCUSDT"] or [] for full map
 * @param {'futures'|'spot'} exchangeType
 * @returns {Promise<Record<string, number>>} symbol -> lastPrice
 */
async function getLastPricesBySymbols(symbols, exchangeType, options = {}) {
  const { strict = false } = options;
  const cacheKey = exchangeType === 'futures' ? 'futures' : 'spot';
  const now = Date.now();
  const hasRequestedSymbols = Array.isArray(symbols) && symbols.length > 0;
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
    const tokens = await fetchTokensWithNATR(exchangeType);
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
    console.warn(`[MEXC getLastPricesBySymbols] ${exchangeType} failed:`, error.message);
    if (strict && hasRequestedSymbols) {
      const upstreamError = new Error(`MEXC ${exchangeType} price feed unavailable: ${error.message}`);
      upstreamError.statusCode = error?.statusCode || error?.response?.status || 503;
      upstreamError.code = 'UPSTREAM_PRICE_UNAVAILABLE';
      throw upstreamError;
    }
    return {};
  }
}

/**
 * Fetch active USDT symbol set for "all coins" complex alerts (same as other exchanges).
 * Returns Set of fullSymbol (e.g. BTCUSDT).
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
    const tokens = await fetchTokensWithNATR(exchangeType);
    const symbols = new Set(
      tokens.filter((t) => t.fullSymbol && t.fullSymbol.endsWith('USDT')).map((t) => t.fullSymbol)
    );
    activeSymbolsCache[cacheKey].symbols = symbols;
    activeSymbolsCache[cacheKey].timestamp = now;
    console.log(`[MEXC ${exchangeType.toUpperCase()}] Active USDT symbols: ${symbols.size}`);
    return symbols;
  } catch (error) {
    console.warn('[MEXC] fetchActiveSymbols failed:', error.message);
    return null;
  }
}

/**
 * Calculate NATR approximation from 24h high/low/lastPrice
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
 * Map our interval to MEXC interval
 * MEXC: 1m, 5m, 15m, 30m, 60m, 4h, 1d, 1M
 */
function mapIntervalToMexc(interval) {
  const map = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '60m',
    '4h': '4h',
    '1d': '1d',
  };
  return map[interval] || '15m';
}

/**
 * Get 24h volume in USDT
 */
function toUsdtVolume(volumeBase, volumeQuote, lastPrice) {
  const quote = Number(volumeQuote);
  const base = Number(volumeBase);
  const price = Number(lastPrice);
  if (Number.isFinite(quote) && quote > 0) return quote;
  if (Number.isFinite(base) && Number.isFinite(price) && price > 0) return base * price;
  return 0;
}

/**
 * Fetch Spot tickers from MEXC
 * MEXC: GET /api/v3/ticker/24hr
 * Response: [{ symbol, lastPrice, highPrice, lowPrice, priceChangePercent, volume, quoteVolume }]
 */
async function fetchSpotTickers(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${MEXC_BASE_URL}/api/v3/ticker/24hr`, {
        timeout: 15000,
      });

      const list = Array.isArray(response.data) ? response.data : [];

      const tokens = list
        .filter((t) => {
          if (!t.symbol) return false;
          if (!t.symbol.endsWith('USDT')) return false;
          const lastPrice = parseFloat(t.lastPrice);
          if (lastPrice === 0 || isNaN(lastPrice)) return false;
          const volumeQuote = parseFloat(t.quoteVolume);
          const volumeBase = parseFloat(t.volume);
          const volumeUsdt = toUsdtVolume(volumeBase, volumeQuote, lastPrice);
          if (volumeUsdt === 0 || !Number.isFinite(volumeUsdt)) return false;
          return true;
        })
        .map((t) => {
          const lastPrice = parseFloat(t.lastPrice);
          const high24h = parseFloat(t.highPrice);
          const low24h = parseFloat(t.lowPrice);
          const changePercent = parseFloat(t.priceChangePercent);
          const volumeBase = parseFloat(t.volume);
          const volumeQuote = parseFloat(t.quoteVolume);

          const fullSymbol = t.symbol;
          const symbol = fullSymbol.replace('USDT', '');

          const volume24h = toUsdtVolume(volumeBase, volumeQuote, lastPrice);

          const token = {
            symbol: String(symbol),
            fullSymbol: String(fullSymbol),
            lastPrice: Number.isFinite(lastPrice) ? Number(lastPrice) : null,
            volume24h: volume24h != null && Number.isFinite(volume24h) ? Number(volume24h) : null,
            priceChangePercent24h: Number.isFinite(changePercent) ? Number(changePercent) : null,
            high24h: Number.isFinite(high24h) ? Number(high24h) : null,
            low24h: Number.isFinite(low24h) ? Number(low24h) : null,
          };
          const natrVal = calculateInstantNATR(token);
          token.natr = natrVal != null && Number.isFinite(natrVal) ? Number(natrVal) : null;
          return token;
        });

      console.log(`[MEXC SPOT] Fetched ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[MEXC] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[MEXC] Error fetching spot tickers:', error.message);
      throw new Error(error.message || 'Failed to fetch MEXC spot tokens');
    }
  }
}

/**
 * Fetch Futures (USDT perpetual) tickers from MEXC
 * MEXC: GET /api/v1/contract/ticker
 * Response: { data: [{ symbol, lastPrice, high24Price, low24Price, riseFallRate, volume24 }] }
 */
async function fetchFuturesTickers(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${MEXC_BASE_URL}/api/v1/contract/ticker`, {
        timeout: 15000,
      });

      const data = response.data?.data || [];
      const list = Array.isArray(data) ? data : [];

      const tokens = list
        .filter((t) => {
          if (!t.symbol) return false;
          if (!t.symbol.includes('USDT')) return false;
          const lastPrice = parseFloat(t.lastPrice);
          if (lastPrice === 0 || isNaN(lastPrice)) return false;
          const volume24 = parseFloat(t.volume24);
          if (!Number.isFinite(volume24) || volume24 === 0) return false;
          return true;
        })
        .map((t) => {
          const lastPrice = parseFloat(t.lastPrice);
          const high24h = parseFloat(t.high24Price);
          const low24h = parseFloat(t.low24Price);
          const changePercent = parseFloat(t.riseFallRate);
          const volumeBase = parseFloat(t.volume24);
          const volumeQuote = parseFloat(t.amount);

          // MEXC futures symbol format: BTC_USDT
          const fullSymbol = t.symbol.replace(/_/g, '');
          const symbol = fullSymbol.replace('USDT', '');

          // Use same pattern as MEXC Spot (which works correctly)
          const volume24h = toUsdtVolume(volumeBase, volumeQuote, lastPrice);

          const token = {
            symbol: String(symbol),
            fullSymbol: String(fullSymbol),
            lastPrice: Number.isFinite(lastPrice) ? Number(lastPrice) : null,
            volume24h: volume24h != null && Number.isFinite(volume24h) ? Number(volume24h) : null,
            priceChangePercent24h: Number.isFinite(changePercent) ? Number(changePercent) : null,
            high24h: Number.isFinite(high24h) ? Number(high24h) : null,
            low24h: Number.isFinite(low24h) ? Number(low24h) : null,
          };
          
          const natrVal = calculateInstantNATR(token);
          token.natr = natrVal != null && Number.isFinite(natrVal) ? Number(natrVal) : null;
          
          return token;
        });

      console.log(`[MEXC FUTURES] Fetched ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[MEXC] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[MEXC] Error fetching futures tickers:', error.message);
      throw new Error(error.message || 'Failed to fetch MEXC futures tokens');
    }
  }
}

/**
 * Fetch tokens with NATR (cached)
 */
async function fetchTokensWithNATR(exchangeType) {
  const cacheKey = exchangeType;
  const now = Date.now();
  if (cache[cacheKey].data && cache[cacheKey].timestamp && now - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }
  const tokens = exchangeType === 'futures' ? await fetchFuturesTickers() : await fetchSpotTickers();
  cache[cacheKey].data = tokens;
  cache[cacheKey].timestamp = now;
  return tokens;
}

/**
 * Resample 1m klines to second intervals
 */
function _lcg(seed) { let s = seed | 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function resample1mToSeconds(klines1m, secondInterval) {
  const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  if (!spanSec) return klines1m;
  const N = 60 / spanSec;
  const result = [];
  for (const candle of klines1m) {
    const { open, high, low, close, volume } = candle;
    const volPer = volume / N;
    const range = high - low;
    if (range === 0) {
      for (let i = 0; i < N; i++) result.push({ time: candle.time + i * spanSec, open, high, low, close, volume: volPer });
      continue;
    }
    const rng = _lcg(candle.time * 7 + spanSec);
    const isGreen = close >= open;
    const halfN = Math.max(1, Math.floor(N / 2));
    let hiIdx, loIdx;
    if (isGreen) { loIdx = 1 + Math.floor(rng() * halfN); hiIdx = halfN + Math.floor(rng() * (N - halfN)); }
    else { hiIdx = 1 + Math.floor(rng() * halfN); loIdx = halfN + Math.floor(rng() * (N - halfN)); }
    hiIdx = Math.min(hiIdx, N - 1); loIdx = Math.min(loIdx, N - 1);
    if (hiIdx === loIdx) { hiIdx = Math.min(hiIdx + 1, N - 1); if (hiIdx === loIdx) loIdx = Math.max(1, loIdx - 1); }
    const prices = new Array(N + 1);
    prices[0] = open; prices[N] = close; prices[hiIdx] = high; prices[loIdx] = low;
    const sorted = [...new Set([0, hiIdx, loIdx, N])].sort((a, b) => a - b);
    for (let s = 0; s < sorted.length - 1; s++) {
      const from = sorted[s], to = sorted[s + 1];
      for (let i = from + 1; i < to; i++) {
        const t = (i - from) / (to - from);
        const base = prices[from] + (prices[to] - prices[from]) * t;
        const noise = (rng() - 0.5) * range * 0.18;
        prices[i] = Math.min(high, Math.max(low, base + noise));
      }
    }
    for (let i = 0; i < N; i++) {
      const sO = prices[i], sC = prices[i + 1];
      const bodyHi = Math.max(sO, sC), bodyLo = Math.min(sO, sC);
      const wick = range * (0.002 + rng() * 0.014);
      result.push({ time: candle.time + i * spanSec, open: sO, high: Math.min(high, bodyHi + wick), low: Math.max(low, bodyLo - wick), close: sC, volume: volPer });
    }
  }
  return result;
}

/**
 * Fetch klines from MEXC. Same output shape: { time, open, high, low, close, volume }, time in seconds
 * Spot: GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=500
 * Futures: GET /api/v1/contract/kline/{symbol}?interval=Min1&limit=500
 * MEXC Spot returns [[ openTime(ms), open, high, low, close, volume, ... ], ...] oldest first
 * MEXC Futures returns { data: [{ open, close, high, low, vol, time(seconds) }] }
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

  const hasBefore = before !== null && before !== undefined && before !== '' && Number.isFinite(Number(before)) && Number(before) > 0;
  const beforeKey = hasBefore ? String(Math.floor(Number(before))) : 'latest';
  const cacheKey = `mexc_${symbol}_${exchangeType}_${interval}_${limit}_${beforeKey}`;
  const now = Date.now();
  if (klinesCache[cacheKey]?.timestamp && now - klinesCache[cacheKey].timestamp < KLINES_CACHE_TTL) {
    return klinesCache[cacheKey].data;
  }

  // For second-level intervals, fetch 1m candles and resample after.
  const isSecondInterval = ['1s', '5s', '15s'].includes(interval);
  const mexcInterval = isSecondInterval ? '1m' : mapIntervalToMexc(interval);
  const mexcLimit = isSecondInterval
    ? { '1s': 50, '5s': 84, '15s': 125 }[interval]
    : limit;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let response;
      if (exchangeType === 'spot') {
        response = await axios.get(`${MEXC_BASE_URL}/api/v3/klines`, {
          params: {
            symbol: symbol.toUpperCase(),
            interval: mexcInterval,
            limit: mexcLimit,
            ...(hasBefore ? { endTime: Math.floor(Number(before)) - 1 } : {}),
          },
          timeout: 10000,
        });
      } else {
        // Futures: interval format Min1, Min5, Min15, Min30, Min60, Hour4, Day1
        const futuresIntervalMap = {
          '1m': 'Min1',
          '5m': 'Min5',
          '15m': 'Min15',
          '30m': 'Min30',
          '60m': 'Min60',
          '1h': 'Min60',
          '4h': 'Hour4',
          '1d': 'Day1',
        };
        const futuresInterval = futuresIntervalMap[mexcInterval] || 'Min15';
        const futuresSymbol = symbol.toUpperCase().replace('USDT', '_USDT');
        
        console.log(`[MEXC] Fetching futures klines for ${futuresSymbol}, interval: ${futuresInterval}, limit: ${mexcLimit}`);
        
        response = await axios.get(`${MEXC_BASE_URL}/api/v1/contract/kline/${futuresSymbol}`, {
          params: {
            interval: futuresInterval,
            limit: mexcLimit,
            ...(hasBefore ? { end: Math.floor(Number(before) / 1000) - 1 } : {}),
          },
          timeout: 10000,
        });
        
        console.log(`[MEXC] Futures klines response code:`, response.data?.code);
        console.log(`[MEXC] Futures klines response success:`, response.data?.success);
      }

      let klines = [];

      if (exchangeType === 'spot') {
        // Spot format: [[ openTime(ms), open, high, low, close, volume, closeTime, quoteVolume, trades, ... ], ...]
        const rawList = Array.isArray(response.data) ? response.data : [];
        klines = rawList.map((arr, index) => {
          if (!Array.isArray(arr) || arr.length < 6) {
            throw new Error(`Invalid candle at index ${index}`);
          }
          const tsMs = parseInt(arr[0], 10);
          const tsSeconds = Math.floor(tsMs / 1000);
          const open = parseFloat(arr[1]);
          const high = parseFloat(arr[2]);
          const low = parseFloat(arr[3]);
          const close = parseFloat(arr[4]);
          const volume = parseFloat(arr[5]) || 0;
          // arr[7] = quoteAssetVolume (USDT turnover) for MEXC spot
          const turnover = parseFloat(arr[7]) || 0;
          if (!Number.isFinite(tsSeconds) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
            throw new Error(`Invalid candle at index ${index}`);
          }
          return { time: tsSeconds, open, high, low, close, volume, turnover };
        });
      } else {
        // Futures format: { success: true, code: 0, data: [{ open, close, high, low, vol, time(seconds) }] }
        // OR: { data: { time: [...], open: [...], close: [...], high: [...], low: [...], vol: [...] } }
        const responseData = response.data?.data;
        
        if (!responseData) {
          console.error('[MEXC] No data in futures klines response:', response.data);
          throw new Error('No data returned from MEXC futures klines API');
        }
        
        // Check if it's array format (list of objects)
        if (Array.isArray(responseData)) {
          console.log(`[MEXC] Futures klines array format, count: ${responseData.length}`);
          if (responseData.length > 0) {
            console.log(`[MEXC] First kline:`, JSON.stringify(responseData[0]));
          }
          klines = responseData.map((item, index) => {
            const tsSeconds = parseInt(item.time, 10);
            const open = parseFloat(item.open);
            const high = parseFloat(item.high);
            const low = parseFloat(item.low);
            const close = parseFloat(item.close);
            const volume = parseFloat(item.vol) || 0;
            if (!Number.isFinite(tsSeconds) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
              console.error(`[MEXC] Invalid kline at index ${index}:`, item);
              throw new Error(`Invalid kline at index ${index}`);
            }
            return { time: tsSeconds, open, high, low, close, volume };
          });
        } else if (typeof responseData === 'object' && responseData.time && Array.isArray(responseData.time)) {
          // Columnar format: { time: [...], open: [...], close: [...], high: [...], low: [...], vol: [...] }
          console.log(`[MEXC] Futures klines columnar format, count: ${responseData.time.length}`);
          const times = responseData.time;
          const opens = responseData.open;
          const highs = responseData.high;
          const lows = responseData.low;
          const closes = responseData.close;
          const volumes = responseData.vol || [];
          
          klines = times.map((time, index) => {
            const tsSeconds = parseInt(time, 10);
            const open = parseFloat(opens[index]);
            const high = parseFloat(highs[index]);
            const low = parseFloat(lows[index]);
            const close = parseFloat(closes[index]);
            const volume = parseFloat(volumes[index]) || 0;
            if (!Number.isFinite(tsSeconds) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
              throw new Error(`Invalid kline at index ${index}`);
            }
            return { time: tsSeconds, open, high, low, close, volume };
          });
        } else {
          console.error('[MEXC] Unknown futures klines data format:', responseData);
          throw new Error('Unknown MEXC futures klines data format');
        }
      }

      // MEXC returns oldest first (chronological) - already in correct order
      const finalKlines = isSecondInterval ? resample1mToSeconds(klines, interval) : klines;
      klinesCache[cacheKey] = { data: finalKlines, timestamp: now };
      console.log(`[MEXC] Fetched ${finalKlines.length} klines for ${symbol} (${interval})`);
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
      throw new Error(error.response?.data?.msg || error.message || `Failed to fetch MEXC klines for ${symbol}`);
    }
  }
}

/**
 * Fetch single token details
 */
async function fetchTokenWithNATR(symbol, exchangeType) {
  const tokens = await fetchTokensWithNATR(exchangeType);
  const fullSymbol = (symbol || '').toUpperCase().replace(/_/g, '');
  const token = tokens.find(
    (t) => t.fullSymbol === fullSymbol || t.fullSymbol === symbol
  );
  if (!token) throw new Error(`Token ${symbol} not found on MEXC`);
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
