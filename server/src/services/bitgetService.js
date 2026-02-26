const axios = require('axios');

const BITGET_BASE_URL = 'https://api.bitget.com/api/v2';

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
 * Normalize symbol to our format (uppercase, no separators) – same as other exchanges.
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
 * Get last price per symbol from Bitget tickers (for alert engine).
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
    console.warn(`[Bitget getLastPricesBySymbols] ${exchangeType} failed:`, error.message);
    if (strict && hasRequestedSymbols) {
      const upstreamError = new Error(`Bitget ${exchangeType} price feed unavailable: ${error.message}`);
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
    console.log(`[Bitget ${exchangeType.toUpperCase()}] Active USDT symbols: ${symbols.size}`);
    return symbols;
  } catch (error) {
    console.warn('[Bitget] fetchActiveSymbols failed:', error.message);
    return null;
  }
}

/**
 * Calculate NATR approximation from 24h high/low/lastPrice (same as Binance/Bybit/OKX/Gate)
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
 * Map our interval to Bitget interval
 * Bitget Futures: 1m, 3m, 5m, 15m, 30m, 1H, 4H, 6H, 12H, 1D, 1W, 1M
 * Bitget Spot: 1min, 3min, 5min, 15min, 30min, 1h, 4h, 6h, 12h, 1day, 1week, 1M
 */
function mapIntervalToBitget(interval, exchangeType = 'futures') {
  if (exchangeType === 'spot') {
    // Spot uses 'min' suffix and lowercase 'h'
    const spotMap = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1h',
      '4h': '4h',
      '1d': '1day',
    };
    return spotMap[interval] || '15min';
  } else {
    // Futures uses short format with uppercase H
    const futuresMap = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1H',
      '4h': '4H',
      '1d': '1D',
    };
    return futuresMap[interval] || '15m';
  }
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
 * Fetch Spot tickers from Bitget
 * Bitget V2: GET /api/v2/spot/market/tickers
 * Response: { code, msg, data: [{ symbol, lastPr, high24h, low24h, changeUtc, quoteVolume, baseVolume }] }
 */
async function fetchSpotTickers(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${BITGET_BASE_URL}/spot/market/tickers`, {
        timeout: 15000,
      });

      const data = response.data?.data || [];
      const list = Array.isArray(data) ? data : [];

      const tokens = list
        .filter((t) => {
          if (!t.symbol) return false;
          if (!t.symbol.endsWith('USDT')) return false;
          const lastPrice = parseFloat(t.lastPr);
          if (lastPrice === 0 || isNaN(lastPrice)) return false;
          const volumeQuote = parseFloat(t.quoteVolume);
          const volumeBase = parseFloat(t.baseVolume);
          const volumeUsdt = toUsdtVolume(volumeBase, volumeQuote, lastPrice);
          if (volumeUsdt === 0 || !Number.isFinite(volumeUsdt)) return false;
          return true;
        })
        .map((t) => {
          const lastPrice = parseFloat(t.lastPr);
          const high24h = parseFloat(t.high24h);
          const low24h = parseFloat(t.low24h);
          const changePercent = parseFloat(t.changeUtc);
          const volumeBase = parseFloat(t.baseVolume);
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

      console.log(`[Bitget SPOT] Fetched ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[Bitget] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[Bitget] Error fetching spot tickers:', error.message);
      throw new Error(error.message || 'Failed to fetch Bitget spot tokens');
    }
  }
}

/**
 * Fetch Futures (USDT perpetual) tickers from Bitget
 * Bitget V2: GET /api/v2/mix/market/tickers?productType=USDT-FUTURES
 * Response: { code, msg, data: [{ symbol, lastPr, high24h, low24h, changeUtc24h, usdtVolume, baseVolume }] }
 */
async function fetchFuturesTickers(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${BITGET_BASE_URL}/mix/market/tickers`, {
        params: {
          productType: 'USDT-FUTURES',
        },
        timeout: 15000,
      });

      const data = response.data?.data || [];
      const list = Array.isArray(data) ? data : [];

      const tokens = list
        .filter((t) => {
          if (!t.symbol) return false;
          if (!t.symbol.includes('USDT')) return false;
          const lastPrice = parseFloat(t.lastPr);
          if (lastPrice === 0 || isNaN(lastPrice)) return false;
          const volumeUsdt = parseFloat(t.usdtVolume);
          if (volumeUsdt === 0 || isNaN(volumeUsdt) || !Number.isFinite(volumeUsdt)) return false;
          return true;
        })
        .map((t) => {
          const lastPrice = parseFloat(t.lastPr);
          const high24h = parseFloat(t.high24h);
          const low24h = parseFloat(t.low24h);
          const changePercent = parseFloat(t.changeUtc24h);
          const volumeUsdt = parseFloat(t.usdtVolume);

          // Bitget futures symbol format: BTCUSDT
          const fullSymbol = t.symbol.replace(/_/g, '');
          const symbol = fullSymbol.replace('USDT', '');

          const token = {
            symbol: String(symbol),
            fullSymbol: String(fullSymbol),
            lastPrice: Number.isFinite(lastPrice) ? Number(lastPrice) : null,
            volume24h: Number.isFinite(volumeUsdt) ? Number(volumeUsdt) : null,
            priceChangePercent24h: Number.isFinite(changePercent) ? Number(changePercent) : null,
            high24h: Number.isFinite(high24h) ? Number(high24h) : null,
            low24h: Number.isFinite(low24h) ? Number(low24h) : null,
          };
          const natrVal = calculateInstantNATR(token);
          token.natr = natrVal != null && Number.isFinite(natrVal) ? Number(natrVal) : null;
          return token;
        });

      console.log(`[Bitget FUTURES] Fetched ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[Bitget] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[Bitget] Error fetching futures tickers:', error.message);
      throw new Error(error.message || 'Failed to fetch Bitget futures tokens');
    }
  }
}

/**
 * Fetch tokens with NATR (cached). Same interface as binanceService.fetchTokensWithNATR
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
 * Resample 1m klines to second intervals (same as Binance/Bybit/OKX/Gate)
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
 * Fetch klines from Bitget. Same output shape as Binance/Bybit/OKX/Gate: { time, open, high, low, close, volume }, time in seconds
 * Spot: GET /api/v2/spot/market/candles?symbol=BTCUSDT&granularity=1m&limit=500
 * Futures: GET /api/v2/mix/market/candles?symbol=BTCUSDT&productType=USDT-FUTURES&granularity=1m&limit=500
 * Bitget returns [[ ts(ms), open, high, low, close, baseVolume, quoteVolume ], ...] newest first
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
  const cacheKey = `bitget_${symbol}_${exchangeType}_${interval}_${limit}_${beforeKey}`;
  const now = Date.now();
  if (klinesCache[cacheKey]?.timestamp && now - klinesCache[cacheKey].timestamp < KLINES_CACHE_TTL) {
    return klinesCache[cacheKey].data;
  }

  const isSecondInterval = ['1s', '5s', '15s'].includes(interval);
  const bitgetInterval = isSecondInterval ? (exchangeType === 'spot' ? '1min' : '1m') : mapIntervalToBitget(interval, exchangeType);
  const bitgetLimit = isSecondInterval ? { '1s': 50, '5s': 84, '15s': 125 }[interval] : limit;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let response;
      if (exchangeType === 'spot') {
        response = await axios.get(`${BITGET_BASE_URL}/spot/market/candles`, {
          params: {
            symbol: symbol.toUpperCase(),
            granularity: bitgetInterval,
            limit: bitgetLimit,
            ...(hasBefore ? { endTime: Math.floor(Number(before)) - 1 } : {}),
          },
          timeout: 10000,
        });
      } else {
        response = await axios.get(`${BITGET_BASE_URL}/mix/market/candles`, {
          params: {
            symbol: symbol.toUpperCase(),
            productType: 'USDT-FUTURES',
            granularity: bitgetInterval,
            limit: bitgetLimit,
            ...(hasBefore ? { endTime: Math.floor(Number(before)) - 1 } : {}),
          },
          timeout: 10000,
        });
      }

      // Check if API returned an error
      if (response.data?.code && response.data.code !== '00000') {
        console.error(`[Bitget] API error for ${symbol}:`, response.data);
        throw new Error(response.data?.msg || `Bitget API error code: ${response.data.code}`);
      }

      const data = response.data?.data || [];
      
      // Debug: log response structure
      console.log(`[Bitget] ${exchangeType} candlesticks response type:`, typeof response.data);
      console.log(`[Bitget] ${exchangeType} response.data.code:`, response.data?.code);
      console.log(`[Bitget] ${exchangeType} response.data.msg:`, response.data?.msg);
      console.log(`[Bitget] ${exchangeType} data is array:`, Array.isArray(data));
      if (data) {
        console.log(`[Bitget] ${exchangeType} data length:`, data.length || 'N/A');
      }
      
      const rawList = Array.isArray(data) ? data : [];
      
      // Log first candle for debugging
      if (rawList.length > 0) {
        console.log(`[Bitget] First raw candle for ${symbol}:`, JSON.stringify(rawList[0]));
      } else {
        console.warn(`[Bitget] No candles returned for ${symbol}`);
      }

      const klines = rawList.map((item, index) => {
        let tsSeconds, open, high, low, close, volume, turnover = 0;
        
        // Handle both array format and object format
        if (Array.isArray(item)) {
          // Array format: [ ts(ms), open, high, low, close, baseVolume, quoteVolume ]
          if (item.length < 5) {
            console.error(`[Bitget] Candle at index ${index} has insufficient length (${item.length}):`, item);
            throw new Error(`Invalid candle at index ${index}: expected at least 5 elements, got ${item.length}`);
          }
          const tsMs = typeof item[0] === 'string' ? parseInt(item[0], 10) : item[0];
          tsSeconds = Math.floor(tsMs / 1000);
          open = parseFloat(item[1]);
          high = parseFloat(item[2]);
          low = parseFloat(item[3]);
          close = parseFloat(item[4]);
          volume = parseFloat(item[5]) || 0;
          // item[6] = quoteVolume (USDT turnover)
          turnover = parseFloat(item[6]) || 0;
        } else if (typeof item === 'object' && item !== null) {
          // Object format: { ts, o, h, l, c, v } or { time, open, high, low, close, volume }
          const tsMs = typeof item.ts === 'string' ? parseInt(item.ts, 10) : (item.ts || item.time || item.timestamp);
          tsSeconds = Math.floor(tsMs / 1000);
          open = parseFloat(item.o || item.open);
          high = parseFloat(item.h || item.high);
          low = parseFloat(item.l || item.low);
          close = parseFloat(item.c || item.close);
          volume = parseFloat(item.v || item.volume || item.baseVol) || 0;
          turnover = parseFloat(item.quoteVol || item.quoteVolume || item.quoteAssetVol) || 0;
        } else {
          console.error(`[Bitget] Candle at index ${index} is neither array nor object:`, item);
          throw new Error(`Invalid candle at index ${index}: unexpected format`);
        }
        
        if (!Number.isFinite(tsSeconds) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
          console.error(`[Bitget] Invalid kline values at index ${index}:`, {
            tsSeconds, open, high, low, close, volume, rawItem: item
          });
          throw new Error(`Invalid kline at index ${index}: non-finite values`);
        }
        return { time: tsSeconds, open, high, low, close, volume, turnover };
      });

      // Bitget returns data in chronological order (oldest first) - NO NEED TO REVERSE!
      // The API documentation was wrong - data is already in correct order
      console.log(`[Bitget] Klines order check - First time: ${klines[0]?.time}, Last time: ${klines[klines.length - 1]?.time}`);

      const finalKlines = isSecondInterval ? resample1mToSeconds(klines, interval) : klines;
      klinesCache[cacheKey] = { data: finalKlines, timestamp: now };
      console.log(`[Bitget] Fetched ${finalKlines.length} klines for ${symbol} (${interval})`);
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
      throw new Error(error.response?.data?.msg || error.message || `Failed to fetch Bitget klines for ${symbol}`);
    }
  }
}

/**
 * Fetch single token details (same as Binance fetchTokenWithNATR)
 */
async function fetchTokenWithNATR(symbol, exchangeType) {
  const tokens = await fetchTokensWithNATR(exchangeType);
  const fullSymbol = (symbol || '').toUpperCase().replace(/_/g, '');
  const token = tokens.find(
    (t) => t.fullSymbol === fullSymbol || t.fullSymbol === symbol
  );
  if (!token) throw new Error(`Token ${symbol} not found on Bitget`);
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
