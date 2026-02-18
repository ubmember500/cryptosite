const axios = require('axios');

const FUTURES_BASE_URL = 'https://fapi.binance.com/fapi/v1';
const SPOT_BASE_URL = 'https://api.binance.com/api/v3';
const FUTURES_BASE_URLS = [
  'https://fapi.binance.com/fapi/v1',
  'https://fapi1.binance.com/fapi/v1',
  'https://fapi2.binance.com/fapi/v1',
  'https://fapi3.binance.com/fapi/v1',
];
const SPOT_BASE_URLS = [
  'https://api.binance.com/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api2.binance.com/api/v3',
  'https://api3.binance.com/api/v3',
];

/**
 * Normalize symbol to Binance format:
 * - trim spaces
 * - uppercase
 * - remove separators like "/" or "-"
 * Example: "zro/usdt" -> "ZROUSDT", "BTC-USDT" -> "BTCUSDT"
 * @param {string} symbol - Symbol to normalize
 * @returns {string} Normalized symbol (empty string if invalid)
 */
function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Caching implementation
const cache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const CACHE_TTL = 300000; // 5 minutes (optimized for faster loading)

// Cache for active symbols (1 hour TTL)
const activeSymbolsCache = {
  futures: { symbols: null, meta: null, timestamp: null },
  spot: { symbols: null, meta: null, timestamp: null },
};
const ACTIVE_SYMBOLS_CACHE_TTL = 3600000; // 1 hour

// Cache for klines data (5-minute TTL)
const klinesCache = {}; // { "symbol_exchangeType_interval": { data, timestamp } }
const KLINES_CACHE_TTL = 300000; // 5 minutes

// Cache for getLastPricesBySymbols (alert engine) – short TTL to avoid repeated calls per cycle.
// NOTE: Cache stores a full symbol -> price map for the last fetch per exchange type.
const lastPricesCache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const LAST_PRICES_CACHE_TTL = 10000; // 10 seconds to reduce Binance pressure
const LAST_PRICES_ERROR_COOLDOWN_MS = 15000; // short cooldown after upstream failures
const lastPricesErrorState = {
  futures: { timestamp: 0 },
  spot: { timestamp: 0 },
};

function filterPriceMapBySymbols(fullMap, symbols) {
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
}

/**
 * Normalize symbol to Binance format:
 * - trim spaces
 * - uppercase
 * - remove separators like "/" or "-"
 * Example: "zro/usdt" -> "ZROUSDT", "BTC-USDT" -> "BTCUSDT"
 * @param {string} symbol - Symbol to normalize
 * @returns {string} Normalized symbol (empty string if invalid)
 */
function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Get last price per symbol from Binance 24hr ticker (for alert engine).
 * Futures: GET fapi.binance.com/fapi/v1/ticker/24hr; Spot: GET api.binance.com/api/v3/ticker/24hr.
 * @param {string[]} symbols - e.g. ["BTCUSDT", "1000XECUSDT"]
 * @param {'futures'|'spot'} exchangeType - market
 * @returns {Promise<Record<string, number>>} Map of symbol -> lastPrice; omits symbols not in response (e.g. delisted)
 */
async function getLastPricesBySymbols(symbols, exchangeType) {
  const cacheKey = exchangeType === 'futures' ? 'futures' : 'spot';
  const now = Date.now();

  const lastErrorTs = lastPricesErrorState[cacheKey].timestamp;
  if (lastErrorTs && now - lastErrorTs < LAST_PRICES_ERROR_COOLDOWN_MS) {
    const cached = lastPricesCache[cacheKey].data || {};
    return filterPriceMapBySymbols(cached, symbols);
  }

  if (
    lastPricesCache[cacheKey].data &&
    lastPricesCache[cacheKey].timestamp &&
    now - lastPricesCache[cacheKey].timestamp < LAST_PRICES_CACHE_TTL
  ) {
    const cached = lastPricesCache[cacheKey].data;
    return filterPriceMapBySymbols(cached, symbols);
  }

  try {
    const response = await requestBinanceWithFallback(
      exchangeType,
      '/ticker/24hr',
      {},
      (data) => Array.isArray(data)
    );
    const tickers = Array.isArray(response.data) ? response.data : [];

    // Build full symbol -> price map from all tickers, keyed by Binance's exact symbol.
    const fullMap = {};
    for (const t of tickers) {
      const symbol = t.symbol;
      if (!symbol) continue;
      const price = parseFloat(t.lastPrice);
      if (!Number.isFinite(price)) continue;
      fullMap[symbol] = price;
    }

    // Cache full map so any later request for any symbol in this market can be served.
    lastPricesCache[cacheKey].data = fullMap;
    lastPricesCache[cacheKey].timestamp = now;
    lastPricesErrorState[cacheKey].timestamp = 0;

    return filterPriceMapBySymbols(fullMap, symbols);
  } catch (error) {
    lastPricesErrorState[cacheKey].timestamp = now;
    console.warn(`[getLastPricesBySymbols] ${exchangeType} failed:`, error.message);
    const cached = lastPricesCache[cacheKey].data || {};
    return filterPriceMapBySymbols(cached, symbols);
  }
}

/**
 * Helper function to wait for a specified time
 * Used for retry logic with exponential backoff
 * @param {number} ms - Milliseconds to wait
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try the same Binance endpoint across multiple hosts to reduce single-host outages / 418 blocks.
 * @param {'futures'|'spot'} exchangeType
 * @param {string} endpoint - Endpoint starting with '/'
 * @param {object} axiosConfig - Axios config
 * @param {(data: any) => boolean} validateData - Optional data shape validator
 * @returns {Promise<import('axios').AxiosResponse<any>>}
 */
async function requestBinanceWithFallback(
  exchangeType,
  endpoint,
  axiosConfig = {},
  validateData = null
) {
  const baseUrls = exchangeType === 'futures' ? FUTURES_BASE_URLS : SPOT_BASE_URLS;
  let lastError;

  for (const baseUrl of baseUrls) {
    try {
      const response = await axios.get(`${baseUrl}${endpoint}`, {
        timeout: 15000,
        ...axiosConfig,
      });

      if (typeof validateData === 'function' && !validateData(response.data)) {
        throw new Error('Invalid payload shape from Binance endpoint');
      }

      return response;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      console.warn(
        `[${exchangeType.toUpperCase()}] ${baseUrl}${endpoint} failed${status ? ` (${status})` : ''}: ${error.message}`
      );
      // Always try next host (418/429/network can be host-specific or temporary).
      continue;
    }
  }

  throw lastError || new Error(`All Binance ${exchangeType} hosts failed for ${endpoint}`);
}

/**
 * Resample 1-minute klines into second-interval klines (1s, 5s, 15s).
 * Binance does not provide second-level klines; we split each 1m candle into N sub-candles
 * with the same OHLC (flat) and volume distributed evenly.
 * @param {Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>} klines1m - 1m candles (time in seconds)
 * @param {'1s'|'5s'|'15s'} secondInterval
 * @returns {Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>}
 */
function resample1mToSeconds(klines1m, secondInterval) {
  const spanSeconds = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  const subPerMinute = 60 / spanSeconds; // 60, 12, or 4
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
 * Fetch active trading symbols from Binance exchangeInfo
 * Filters for status === "TRADING" and symbol.endsWith('USDT')
 * Caches results for 1 hour
 * @param {string} exchangeType - "futures" | "spot"
 * @returns {Set|null} Set of active symbol strings, or null if fetch fails
 */
async function fetchActiveSymbols(exchangeType) {
  const cacheKey = exchangeType;
  const now = Date.now();

  // Check cache
  if (
    activeSymbolsCache[cacheKey].symbols &&
    activeSymbolsCache[cacheKey].timestamp &&
    now - activeSymbolsCache[cacheKey].timestamp < ACTIVE_SYMBOLS_CACHE_TTL
  ) {
    return activeSymbolsCache[cacheKey].symbols;
  }

  try {
    const response = await requestBinanceWithFallback(
      exchangeType,
      '/exchangeInfo',
      {},
      (data) => Array.isArray(data?.symbols)
    );

    let activeSymbols;
    const symbolMeta = new Map(
      (response.data.symbols || []).map((s) => [
        s.symbol,
        {
          status: s.status,
          contractType: s.contractType,
          quoteAsset: s.quoteAsset,
        },
      ])
    );

    if (exchangeType === 'futures') {
      // Futures: use only currently tradable USDT contracts.
      // This avoids non-tradable/retired symbols that can appear in metadata
      // but fail on kline endpoints with "Invalid symbol".
      activeSymbols = new Set(
        response.data.symbols
          .filter(
            (s) =>
              typeof s.symbol === 'string' &&
              s.symbol.endsWith('USDT') &&
              s.status === 'TRADING'
          )
          .map((s) => s.symbol)
      );
    } else {
      // Spot: keep strict active TRADING USDT pairs.
      activeSymbols = new Set(
        response.data.symbols
          .filter((s) => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
          .map((s) => s.symbol)
      );
    }

    // Update cache
    activeSymbolsCache[cacheKey].symbols = activeSymbols;
    activeSymbolsCache[cacheKey].meta = symbolMeta;
    activeSymbolsCache[cacheKey].timestamp = now;

    console.log(
      `[${exchangeType.toUpperCase()}] Found ${activeSymbols.size} ${exchangeType === 'futures' ? 'USDT contracts' : 'active USDT symbols'} from metadata`
    );
    return activeSymbols;
  } catch (error) {
    console.warn(
      `[${exchangeType.toUpperCase()}] Failed to fetch exchangeInfo, using fallback:`,
      error.message
    );
    return null; // Return null to indicate fallback needed
  }
}

function getCachedSymbolMeta(exchangeType) {
  const cacheKey = exchangeType === 'futures' ? 'futures' : 'spot';
  return activeSymbolsCache[cacheKey].meta || null;
}

/**
 * Fetch Futures tokens from Binance
 * Filters only USDT pairs
 * Implements retry logic for rate limiting
 */
async function fetchFuturesTokens(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await requestBinanceWithFallback(
        'futures',
        '/ticker/24hr',
        {},
        (data) => Array.isArray(data)
      );

      // Log count from Binance API (before filtering)
      const totalFromAPI = response.data?.length || 0;
      console.log(`[Futures] Binance API returned ${totalFromAPI} total tickers`);

      // Get active symbols from exchangeInfo
      const activeSymbols = await fetchActiveSymbols('futures');
      const symbolMeta = getCachedSymbolMeta('futures');

      // Build ticker map for quick joins by full symbol
      const tickerMap = new Map(
        response.data
          .filter((ticker) => typeof ticker?.symbol === 'string' && ticker.symbol.includes('USDT'))
          .map((ticker) => [ticker.symbol, ticker])
      );

      // Prefer metadata universe (includes contracts that may not have 24h stats yet).
      const symbolUniverse = activeSymbols && activeSymbols.size > 0
        ? Array.from(activeSymbols)
        : Array.from(tickerMap.keys());

      // Keep ticker order first, then append symbols that are absent in /ticker/24hr.
      const orderedFromTicker = response.data
        .filter((ticker) => typeof ticker?.symbol === 'string' && symbolUniverse.includes(ticker.symbol))
        .map((ticker) => ticker.symbol);
      const orderedSet = new Set(orderedFromTicker);
      const missingFromTicker = symbolUniverse.filter((symbol) => !orderedSet.has(symbol));
      const futuresSymbols = [...orderedFromTicker, ...missingFromTicker];

      const usdtCount = futuresSymbols.length;
      const activeCount = activeSymbols ? activeSymbols.size : 'unknown';
      console.log(
        `[Futures] Symbols from metadata: ${activeCount}, After merge with ticker: ${usdtCount} tokens`
      );

      // Transform data - ensure all tokens are included even with invalid data
      // Calculate NATR instantly using ticker data
      const tokens = futuresSymbols.map((fullSymbol) => {
        const ticker = tickerMap.get(fullSymbol) || {};
        const meta = symbolMeta?.get(fullSymbol);
        const isTrading = meta ? meta.status === 'TRADING' : true;

        // Use null/NaN for invalid values instead of excluding tokens
        const lastPrice = parseFloat(ticker.lastPrice);
        const volume24h = parseFloat(ticker.quoteVolume || ticker.volume); // Use quoteVolume (USD), fallback to volume
        const priceChangePercent24h = parseFloat(ticker.priceChangePercent);
        const high24h = parseFloat(ticker.highPrice);
        const low24h = parseFloat(ticker.lowPrice);

        const normalizedLastPrice = isTrading && Number.isFinite(lastPrice) && lastPrice > 0
          ? lastPrice
          : null;
        const normalizedVolume24h = isTrading && Number.isFinite(volume24h) && volume24h > 0
          ? volume24h
          : null;
        const normalizedPriceChangePercent24h = isTrading && Number.isFinite(priceChangePercent24h)
          ? priceChangePercent24h
          : null;
        const normalizedHigh24h = isTrading && Number.isFinite(high24h) && high24h > 0
          ? high24h
          : null;
        const normalizedLow24h = isTrading && Number.isFinite(low24h) && low24h > 0
          ? low24h
          : null;

        const token = {
          symbol: fullSymbol.replace('USDT', ''),
          fullSymbol,
          lastPrice: normalizedLastPrice,
          volume24h: normalizedVolume24h,
          priceChangePercent24h: normalizedPriceChangePercent24h,
          high24h: normalizedHigh24h,
          low24h: normalizedLow24h,
        };

        // Calculate instant NATR using ticker data
        token.natr = calculateInstantNATR(token);

        return token;
      });

      console.log(`[Futures] ${tokens.length} tokens after transformation with instant NATR (should match ${usdtCount})`);

      // Verify no tokens were lost
      if (tokens.length !== usdtCount) {
        console.warn(
          `[Futures] WARNING: Token count mismatch! Expected ${usdtCount}, got ${tokens.length}`
        );
      }

      return tokens;
    } catch (error) {
      // Handle rate limiting (429) with retry
      if (error.response?.status === 429) {
        if (attempt < retries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.warn(
            `Rate limit exceeded for Futures tokens. Retrying in ${waitTime}ms... (attempt ${attempt + 1}/${retries + 1})`
          );
          await wait(waitTime);
          continue;
        } else {
          console.error('Rate limit exceeded for Futures tokens after retries');
          throw new Error('Rate limit exceeded. Please try again later.');
        }
      }

      // Handle network errors
      if (!error.response && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`Network error fetching Futures tokens. Retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }

      if (cache.futures.data && cache.futures.data.length > 0) {
        console.warn('[Futures] Returning stale cached tokens due to Binance API failure');
        return cache.futures.data;
      }

      console.error('Error fetching Futures tokens:', error.message);
      throw new Error('Failed to fetch Futures tokens from Binance');
    }
  }
}

/**
 * Fetch Spot tokens from Binance
 * Filters only USDT pairs
 * Implements retry logic for rate limiting
 */
async function fetchSpotTokens(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await requestBinanceWithFallback(
        'spot',
        '/ticker/24hr',
        {},
        (data) => Array.isArray(data)
      );

      // Log count from Binance API (before filtering)
      const totalFromAPI = response.data?.length || 0;
      console.log(`[Spot] Binance API returned ${totalFromAPI} total tickers`);

      // Get active symbols from exchangeInfo
      const activeSymbols = await fetchActiveSymbols('spot');

      // Filter tickers: active symbols, USDT pairs, valid volume and price
      const usdtTickers = response.data.filter((ticker) => {
        // Must end with USDT
        if (!ticker.symbol.endsWith('USDT')) return false;

        // Must be in active symbols list (if available)
        if (activeSymbols && !activeSymbols.has(ticker.symbol)) return false;

        // Must have valid volume and price
        const volume = parseFloat(ticker.quoteVolume || ticker.volume); // Use quoteVolume (USD), fallback to volume
        const lastPrice = parseFloat(ticker.lastPrice);
        if (volume === 0 || isNaN(volume)) return false;
        if (lastPrice === 0 || isNaN(lastPrice)) return false;

        return true;
      });

      const usdtCount = usdtTickers.length;
      const activeCount = activeSymbols ? activeSymbols.size : 'unknown';
      console.log(
        `[Spot] Active symbols from exchangeInfo: ${activeCount}, After filtering: ${usdtCount} tokens`
      );

      // Transform data - ensure all tokens are included even with invalid data
      // Calculate NATR instantly using ticker data
      const tokens = usdtTickers.map((ticker) => {
        // Use null/NaN for invalid values instead of excluding tokens
        const lastPrice = parseFloat(ticker.lastPrice);
        const volume24h = parseFloat(ticker.quoteVolume || ticker.volume); // Use quoteVolume (USD), fallback to volume
        const priceChangePercent24h = parseFloat(ticker.priceChangePercent);
        const high24h = parseFloat(ticker.highPrice);
        const low24h = parseFloat(ticker.lowPrice);

        const token = {
          symbol: ticker.symbol.replace('USDT', ''), // Extract "BTC" from "BTCUSDT"
          fullSymbol: ticker.symbol, // "BTCUSDT"
          lastPrice: isNaN(lastPrice) ? null : lastPrice,
          volume24h: isNaN(volume24h) ? null : volume24h,
          priceChangePercent24h: isNaN(priceChangePercent24h)
            ? null
            : priceChangePercent24h,
          high24h: isNaN(high24h) ? null : high24h,
          low24h: isNaN(low24h) ? null : low24h,
        };

        // Calculate instant NATR using ticker data
        token.natr = calculateInstantNATR(token);

        return token;
      });

      console.log(`[Spot] ${tokens.length} tokens after transformation with instant NATR (should match ${usdtCount})`);

      // Verify no tokens were lost
      if (tokens.length !== usdtCount) {
        console.warn(
          `[Spot] WARNING: Token count mismatch! Expected ${usdtCount}, got ${tokens.length}`
        );
      }

      return tokens;
    } catch (error) {
      // Handle rate limiting (429) with retry
      if (error.response?.status === 429) {
        if (attempt < retries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.warn(
            `Rate limit exceeded for Spot tokens. Retrying in ${waitTime}ms... (attempt ${attempt + 1}/${retries + 1})`
          );
          await wait(waitTime);
          continue;
        } else {
          console.error('Rate limit exceeded for Spot tokens after retries');
          throw new Error('Rate limit exceeded. Please try again later.');
        }
      }

      // Handle network errors
      if (!error.response && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`Network error fetching Spot tokens. Retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }

      if (cache.spot.data && cache.spot.data.length > 0) {
        console.warn('[Spot] Returning stale cached tokens due to Binance API failure');
        return cache.spot.data;
      }

      console.error('Error fetching Spot tokens:', error.message);
      throw new Error('Failed to fetch Spot tokens from Binance');
    }
  }
}

/**
 * Calculate instant NATR approximation using ticker data
 * Uses 24h high/low/price from ticker (no API calls needed)
 * @param {Object} token - Token object with high24h, low24h, lastPrice
 * @returns {number|null} NATR as percentage, or null if calculation not possible
 */
function calculateInstantNATR(token) {
  // token already has: high24h, low24h, lastPrice from ticker
  if (
    token.high24h === null ||
    token.low24h === null ||
    token.lastPrice === null ||
    token.lastPrice === 0
  ) {
    return null;
  }

  const trueRange = token.high24h - token.low24h;
  const natr = (trueRange / token.lastPrice) * 100;
  return parseFloat(natr.toFixed(2));
}

/**
 * Fetch tokens with instant NATR calculation
 * NATR is calculated instantly using ticker data (no API calls needed)
 * Implements caching with 5-minute TTL
 * @param {string} exchangeType - "futures" | "spot"
 * @param {{ forceFresh?: boolean }} options - Optional behavior flags
 * @returns {Array} Array of tokens with instant NATR
 */
async function fetchTokensWithNATR(exchangeType, options = {}) {
  const { forceFresh = false } = options;
  const now = Date.now();
  const cacheKey = exchangeType;

  // Check cache - return immediately if valid cache exists
  if (
    !forceFresh &&
    cache[cacheKey].data &&
    cache[cacheKey].timestamp &&
    now - cache[cacheKey].timestamp < CACHE_TTL
  ) {
    console.log(
      `[${exchangeType.toUpperCase()}] Returning cached data (${cache[cacheKey].data.length} tokens)`
    );
    return cache[cacheKey].data;
  }

  if (forceFresh) {
    console.log(`[${exchangeType.toUpperCase()}] forceFresh enabled, bypassing token cache`);
    activeSymbolsCache[cacheKey].symbols = null;
    activeSymbolsCache[cacheKey].meta = null;
    activeSymbolsCache[cacheKey].timestamp = null;
  }

  try {
    // Fetch tokens based on exchange type
    let tokens;
    if (exchangeType === 'futures') {
      tokens = await fetchFuturesTokens();
    } else if (exchangeType === 'spot') {
      tokens = await fetchSpotTokens();
    } else {
      throw new Error('Invalid exchangeType. Must be "futures" or "spot"');
    }

    // NATR is already calculated instantly in fetchFuturesTokens/fetchSpotTokens
    // using ticker data (high24h, low24h, lastPrice)
    console.log(
      `[${exchangeType.toUpperCase()}] Returning ${tokens.length} tokens with instant NATR`
    );

    // Update cache with tokens (NATR already included)
    cache[cacheKey].data = tokens;
    cache[cacheKey].timestamp = now;

    // Return tokens with instant NATR (already calculated from ticker data)
    return tokens;
  } catch (error) {
    console.error(`Error fetching tokens with NATR for ${exchangeType}:`, error);
    throw error;
  }
}

/**
 * Fetch klines (candlestick data) from Binance
 * Implements retry logic with exponential backoff for rate limiting
 * @param {string} symbol - Token symbol (e.g., "BTCUSDT")
 * @param {string} exchangeType - "futures" | "spot"
 * @param {string} interval - Time interval: "1s", "5s", "15s", "1m", "5m", "15m", "30m", "1h", "4h", "1d" (default: "15m")
 * @param {number} limit - Number of candles (default: 500)
 * @param {number} retries - Number of retry attempts (default: 1 for faster initial load)
 * @returns {Array} Array of candle objects: { time, open, high, low, close, volume }
 */
async function fetchKlines(
  symbol,
  exchangeType,
  interval = '15m',
  limit = 500,
  options = {}
) {
  const { retries = 1, before = null } = options || {};
  // Validate interval (1s, 5s, 15s may not be supported by all Binance endpoints)
  const validIntervals = ['1s', '5s', '15s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];
  if (!validIntervals.includes(interval)) {
    throw new Error(`Invalid interval. Must be one of: ${validIntervals.join(', ')}`);
  }

  // Validate limit
  if (limit < 1 || limit > 1000) {
    throw new Error('Limit must be between 1 and 1000');
  }

  // Validate exchangeType
  if (!['futures', 'spot'].includes(exchangeType)) {
    throw new Error('Invalid exchangeType. Must be "futures" or "spot"');
  }

  // Create cache key
  const hasBefore = before !== null && before !== undefined && before !== '' && Number.isFinite(Number(before)) && Number(before) > 0;
  const beforeKey = hasBefore ? String(Math.floor(Number(before))) : 'latest';
  const cacheKey = `${symbol.toUpperCase()}_${exchangeType}_${interval}_${limit}_${beforeKey}`;
  const now = Date.now();

  // Second intervals: Binance only has 1m+. We fetch 1m and resample to 1s/5s/15s.
  const isSecondInterval = ['1s', '5s', '15s'].includes(interval);
  const binanceInterval = isSecondInterval ? '1m' : interval;
  // Keep resampled count reasonable: 1s -> 50 1m = 3000 candles, 5s -> 84 1m ≈ 1000, 15s -> 125 1m = 500
  const binanceLimit = isSecondInterval
    ? { '1s': 50, '5s': 84, '15s': 125 }[interval]
    : limit;

  // Check cache
  if (
    klinesCache[cacheKey] &&
    klinesCache[cacheKey].timestamp &&
    now - klinesCache[cacheKey].timestamp < KLINES_CACHE_TTL
  ) {
    console.log(
      `[${exchangeType.toUpperCase()}] Returning cached klines for ${symbol} (${interval})`
    );
    return klinesCache[cacheKey].data;
  }

  // Retry logic with exponential backoff
  for (let attempt = 0; attempt <= retries; attempt++) {
    const requestStartTime = Date.now();
    try {
      const baseUrl =
        exchangeType === 'futures' ? FUTURES_BASE_URL : SPOT_BASE_URL;
      const endpoint = `${baseUrl}/klines`;

      console.log(
        `[${exchangeType.toUpperCase()}] Fetching klines for ${symbol} (${binanceInterval}, limit: ${binanceLimit})${isSecondInterval ? ` -> resample to ${interval}` : ''}${attempt > 0 ? ` [Retry ${attempt}/${retries}]` : ''} [Start: ${new Date(requestStartTime).toISOString()}]`
      );

      const response = await axios.get(endpoint, {
        params: {
          symbol: symbol.toUpperCase(),
          interval: binanceInterval,
          limit: binanceLimit,
          ...(hasBefore ? { endTime: Math.floor(Number(before)) - 1 } : {}),
        },
        timeout: 5000, // 5 second timeout (reduced for faster failure)
      });

      // Validate response data
      if (!Array.isArray(response.data)) {
        throw new Error('Invalid response format from Binance API');
      }

      if (response.data.length === 0) {
        console.warn(
          `[${exchangeType.toUpperCase()}] No klines data returned for ${symbol}`
        );
        return [];
      }

      // Transform Binance klines format to our format
      // Binance returns: [openTime, open, high, low, close, volume, ...]
      // Transform to: { time, open, high, low, close, volume }
      // time should be Unix timestamp in seconds (for lightweight-charts)
      const klines = response.data.map((kline, index) => {
        if (!Array.isArray(kline) || kline.length < 6) {
          throw new Error(
            `Invalid kline format from Binance API at index ${index}`
          );
        }

        // Parse and validate time (milliseconds -> seconds)
        const openTimeMs = parseInt(kline[0], 10);
        if (isNaN(openTimeMs) || openTimeMs <= 0) {
          throw new Error(
            `Invalid openTime at kline index ${index}: ${kline[0]}`
          );
        }
        const time = Math.floor(openTimeMs / 1000); // Convert milliseconds to seconds

        // Parse and validate numeric fields
        const parseNumericField = (value, fieldName, klineIndex) => {
          const parsed = parseFloat(value);
          if (isNaN(parsed) || !isFinite(parsed)) {
            throw new Error(
              `Invalid ${fieldName} at kline index ${klineIndex}: ${value}`
            );
          }
          return parsed;
        };

        const open = parseNumericField(kline[1], 'open', index);
        const high = parseNumericField(kline[2], 'high', index);
        const low = parseNumericField(kline[3], 'low', index);
        const close = parseNumericField(kline[4], 'close', index);
        const volume = parseNumericField(kline[5], 'volume', index);

        // Validate price relationships
        if (high < low) {
          throw new Error(
            `Invalid price relationship at kline index ${index}: high (${high}) < low (${low})`
          );
        }

        // Ensure all values are within valid ranges
        if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
          throw new Error(
            `Invalid price values at kline index ${index}: prices must be positive`
          );
        }

        if (volume < 0) {
          throw new Error(
            `Invalid volume at kline index ${index}: volume cannot be negative`
          );
        }

        return {
          time, // Unix timestamp in seconds (for lightweight-charts)
          open, // All values are numbers, not strings
          high,
          low,
          close,
          volume,
        };
      });

      // Resample 1m to 1s/5s/15s when requested (Binance has no second-level klines)
      const finalKlines = isSecondInterval
        ? resample1mToSeconds(klines, interval)
        : klines;

      // Update cache
      klinesCache[cacheKey] = {
        data: finalKlines,
        timestamp: now,
      };

      // Calculate request duration
      const requestDuration = Date.now() - requestStartTime;
      const durationSeconds = (requestDuration / 1000).toFixed(2);

      // Log completion with performance warning if slow
      if (requestDuration > 2000) {
        console.warn(
          `[${exchangeType.toUpperCase()}] ⚠️  Performance warning: Fetched ${finalKlines.length} klines for ${symbol} (${interval}) in ${durationSeconds}s [Completion: ${new Date().toISOString()}]`
        );
      } else {
        console.log(
          `[${exchangeType.toUpperCase()}] Successfully fetched ${finalKlines.length} klines for ${symbol} (${interval}) in ${durationSeconds}s [Completion: ${new Date().toISOString()}]`
        );
      }

      return finalKlines;
    } catch (error) {
      const errorStatus = error.response?.status;
      const errorMessage = error.response?.data?.msg || error.message;

      // Handle rate limiting (429) with retry
      if (errorStatus === 429) {
        if (attempt < retries) {
          const waitTime = Math.pow(2, attempt) * 500; // Exponential backoff: 0.5s, 1s (faster retries)
          const retryAfter = error.response?.headers['retry-after']
            ? parseInt(error.response.headers['retry-after']) * 1000
            : waitTime;
          const finalWaitTime = Math.max(waitTime, retryAfter);

          console.warn(
            `[${exchangeType.toUpperCase()}] Rate limit exceeded for ${symbol}. Retrying in ${finalWaitTime}ms... (attempt ${attempt + 1}/${retries + 1})`
          );
          await wait(finalWaitTime);
          continue;
        } else {
          const requestDuration = Date.now() - requestStartTime;
          console.error(
            `[${exchangeType.toUpperCase()}] Rate limit exceeded for ${symbol} after ${retries + 1} attempts (duration: ${(requestDuration / 1000).toFixed(2)}s)`
          );
          throw new Error(
            `Rate limit exceeded. Binance API is temporarily unavailable. Please try again later.`
          );
        }
      }

      // Handle invalid symbols or parameters (400)
      if (errorStatus === 400) {
        const binanceErrorMsg = error.response?.data?.msg || errorMessage;
        console.error(
          `[${exchangeType.toUpperCase()}] Invalid request for ${symbol}: ${binanceErrorMsg}`
        );
        throw new Error(
          `Invalid symbol or parameters: ${symbol}. Binance error: ${binanceErrorMsg}`
        );
      }

      // Handle network errors (timeout, connection errors, etc.)
      if (!error.response) {
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          const requestDuration = Date.now() - requestStartTime;
          console.warn(
            `[${exchangeType.toUpperCase()}] Request timeout for ${symbol} (duration: ${(requestDuration / 1000).toFixed(2)}s). ${attempt < retries ? 'Retrying...' : ''}`
          );
          if (attempt < retries) {
            await wait(Math.pow(2, attempt) * 500); // Faster retries: 0.5s, 1s
            continue;
          }
          throw new Error(
            `Network timeout: Unable to connect to Binance API. Please check your internet connection and try again.`
          );
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          const requestDuration = Date.now() - requestStartTime;
          console.error(
            `[${exchangeType.toUpperCase()}] Network error for ${symbol} (duration: ${(requestDuration / 1000).toFixed(2)}s): ${error.message}`
          );
          throw new Error(
            `Network error: Cannot reach Binance API. Please check your internet connection.`
          );
        }

        const requestDuration = Date.now() - requestStartTime;
        console.error(
          `[${exchangeType.toUpperCase()}] Network error for ${symbol} (duration: ${(requestDuration / 1000).toFixed(2)}s):`,
          error.message
        );
        if (attempt < retries) {
          await wait(Math.pow(2, attempt) * 500); // Faster retries: 0.5s, 1s
          continue;
        }
        throw new Error(`Network error: ${error.message}`);
      }

      // Handle other HTTP errors (500, 502, 503, etc.)
      if (errorStatus >= 500) {
        const requestDuration = Date.now() - requestStartTime;
        console.warn(
          `[${exchangeType.toUpperCase()}] Binance server error (${errorStatus}) for ${symbol} (duration: ${(requestDuration / 1000).toFixed(2)}s). ${attempt < retries ? 'Retrying...' : ''}`
        );
        if (attempt < retries) {
          await wait(Math.pow(2, attempt) * 500); // Faster retries: 0.5s, 1s
          continue;
        }
        throw new Error(
          `Binance API server error (${errorStatus}). Please try again later.`
        );
      }

      // Handle other errors
      const requestDuration = Date.now() - requestStartTime;
      console.error(
        `[${exchangeType.toUpperCase()}] Error fetching klines for ${symbol} (duration: ${(requestDuration / 1000).toFixed(2)}s):`,
        {
          status: errorStatus,
          message: errorMessage,
          error: error.message,
        }
      );
      throw new Error(
        `Failed to fetch klines for ${symbol}: ${errorMessage || error.message}`
      );
    }
  }
}

/**
 * Fetch single token with instant NATR
 * @param {string} symbol - Full symbol (e.g., "BTCUSDT")
 * @param {string} exchangeType - "futures" | "spot"
 * @returns {Object} Token object with instant NATR
 */
async function fetchTokenWithNATR(symbol, exchangeType) {
  try {
    // Fetch tokens (NATR already calculated instantly)
    let tokens;
    if (exchangeType === 'futures') {
      tokens = await fetchFuturesTokens();
    } else if (exchangeType === 'spot') {
      tokens = await fetchSpotTokens();
    } else {
      throw new Error('Invalid exchangeType. Must be "futures" or "spot"');
    }

    // Find the specific token
    const token = tokens.find((t) => t.fullSymbol === symbol.toUpperCase());

    if (!token) {
      throw new Error(`Token ${symbol} not found`);
    }

    // NATR is already calculated in fetchFuturesTokens/fetchSpotTokens
    return token;
  } catch (error) {
    console.error(`Error fetching token ${symbol} with NATR:`, error.message);
    throw error;
  }
}

module.exports = {
  fetchFuturesTokens,
  fetchSpotTokens,
  fetchActiveSymbols,
  calculateInstantNATR,
  fetchTokensWithNATR,
  fetchTokenWithNATR,
  fetchKlines,
  getLastPricesBySymbols,
  normalizeSymbol,
};
