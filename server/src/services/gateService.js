const axios = require('axios');

const GATE_BASE_URL = 'https://api.gateio.ws/api/v4';

const CACHE_TTL = 300000; // 5 minutes
const cache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const klinesCache = {};
const KLINES_CACHE_TTL = 300000;

// Alert engine: last prices cache (short TTL, same as Binance/Bybit/OKX)
const lastPricesCache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const LAST_PRICES_CACHE_TTL = 2000; // 2 seconds

// Active symbols cache for "all coins" complex alerts (fullSymbol format: BTCUSDT)
const activeSymbolsCache = {
  futures: { symbols: null, timestamp: null },
  spot: { symbols: null, timestamp: null },
};
const ACTIVE_SYMBOLS_CACHE_TTL = 3600000; // 1 hour

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize symbol to our format (uppercase, no separators) – same as Binance/Bybit/OKX.
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
 * Get last price per symbol from Gate.io tickers (for alert engine).
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
    console.warn(`[Gate.io getLastPricesBySymbols] ${exchangeType} failed:`, error.message);
    if (strict && hasRequestedSymbols) {
      const upstreamError = new Error(`Gate ${exchangeType} price feed unavailable: ${error.message}`);
      upstreamError.statusCode = error?.statusCode || error?.response?.status || 503;
      upstreamError.code = 'UPSTREAM_PRICE_UNAVAILABLE';
      throw upstreamError;
    }
    return {};
  }
}

/**
 * Fetch active USDT symbol set for "all coins" complex alerts (same as Binance/Bybit/OKX).
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
    console.log(`[Gate.io ${exchangeType.toUpperCase()}] Active USDT symbols: ${symbols.size}`);
    return symbols;
  } catch (error) {
    console.warn('[Gate.io] fetchActiveSymbols failed:', error.message);
    return null;
  }
}

/**
 * Calculate NATR approximation from 24h high/low/lastPrice (same as Binance/Bybit/OKX)
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
 * Convert our symbol (e.g. BTCUSDT) to Gate format
 * Spot: BTC_USDT, Futures: BTC_USDT (contract name)
 */
function symbolToGatePair(symbol, exchangeType) {
  const base = typeof symbol === 'string' ? symbol.replace(/USDT$/i, '').trim() : '';
  if (!base) return null;
  return `${base}_USDT`;
}

/**
 * Convert Gate pair to fullSymbol (BTCUSDT) for consistency with Binance/Bybit/OKX
 */
function gatePairToFullSymbol(pair) {
  if (!pair) return null;
  return pair.replace(/_/g, '');
}

/**
 * Map our interval to Gate interval
 * Gate: 10s, 1m, 5m, 15m, 30m, 1h, 4h, 1d, etc.
 */
function mapIntervalToGate(interval) {
  const map = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };
  return map[interval] || '15m';
}

/**
 * Get 24h volume in USDT – same as Bybit turnover. Gate returns volume_24h_quote (USDT).
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
 * Fetch Spot tickers from Gate.io
 * Gate: GET /api/v4/spot/tickers
 * Response: [{ currency_pair, last, highest_24h, lowest_24h, change_percentage, base_volume, quote_volume }]
 */
async function fetchSpotTickers(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${GATE_BASE_URL}/spot/tickers`, {
        timeout: 15000,
      });

      const list = Array.isArray(response.data) ? response.data : [];

      const tokens = list
        .filter((t) => {
          if (!t.currency_pair) return false;
          if (!t.currency_pair.endsWith('_USDT')) return false;
          const lastPrice = parseFloat(t.last);
          if (lastPrice === 0 || isNaN(lastPrice)) return false;
          const volumeQuote = parseFloat(t.quote_volume);
          const volumeBase = parseFloat(t.base_volume);
          const volumeUsdt = toUsdtVolume(volumeBase, volumeQuote, lastPrice);
          if (volumeUsdt === 0 || !Number.isFinite(volumeUsdt)) return false;
          return true;
        })
        .map((t) => {
          const lastPrice = parseFloat(t.last);
          const high24h = parseFloat(t.highest_24h);
          const low24h = parseFloat(t.lowest_24h);
          const changePercent = parseFloat(t.change_percentage);
          const volumeBase = parseFloat(t.base_volume);
          const volumeQuote = parseFloat(t.quote_volume);

          const fullSymbol = gatePairToFullSymbol(t.currency_pair);
          const symbol = fullSymbol ? fullSymbol.replace('USDT', '') : t.currency_pair.split('_')[0];

          const volume24h = toUsdtVolume(volumeBase, volumeQuote, lastPrice);

          const token = {
            symbol: String(symbol),
            fullSymbol: String(fullSymbol || t.currency_pair),
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

      console.log(`[Gate.io SPOT] Fetched ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[Gate.io] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[Gate.io] Error fetching spot tickers:', error.message);
      throw new Error(error.message || 'Failed to fetch Gate.io spot tokens');
    }
  }
}

/**
 * Fetch Futures (USDT perpetual) tickers from Gate.io
 * Gate: GET /api/v4/futures/usdt/tickers
 * Response: [{ contract, last, mark_price, index_price, high_24h, low_24h, change_percentage, total, volume_24h_base, volume_24h_quote, volume_24h_settle }]
 */
async function fetchFuturesTickers(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${GATE_BASE_URL}/futures/usdt/tickers`, {
        timeout: 15000,
      });

      const list = Array.isArray(response.data) ? response.data : [];

      const tokens = list
        .filter((t) => {
          if (!t.contract) return false;
          if (!t.contract.includes('USDT')) return false;
          const lastPrice = parseFloat(t.last);
          if (lastPrice === 0 || isNaN(lastPrice)) return false;
          const volumeQuote = parseFloat(t.volume_24h_quote);
          const volumeBase = parseFloat(t.volume_24h_base);
          const volumeUsdt = toUsdtVolume(volumeBase, volumeQuote, lastPrice);
          if (volumeUsdt === 0 || !Number.isFinite(volumeUsdt)) return false;
          return true;
        })
        .map((t) => {
          const lastPrice = parseFloat(t.last);
          const high24h = parseFloat(t.high_24h);
          const low24h = parseFloat(t.low_24h);
          const changePercent = parseFloat(t.change_percentage);
          const volumeBase = parseFloat(t.volume_24h_base);
          const volumeQuote = parseFloat(t.volume_24h_quote);

          const fullSymbol = gatePairToFullSymbol(t.contract);
          const symbol = fullSymbol ? fullSymbol.replace('USDT', '') : t.contract.split('_')[0];

          const volume24h = toUsdtVolume(volumeBase, volumeQuote, lastPrice);

          const token = {
            symbol: String(symbol),
            fullSymbol: String(fullSymbol || t.contract),
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

      console.log(`[Gate.io FUTURES] Fetched ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[Gate.io] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[Gate.io] Error fetching futures tickers:', error.message);
      throw new Error(error.message || 'Failed to fetch Gate.io futures tokens');
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
 * Resample 1m klines to second intervals (same as Binance/Bybit/OKX)
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
 * Fetch klines from Gate.io. Same output shape as Binance/Bybit/OKX: { time, open, high, low, close, volume }, time in seconds
 * Spot: GET /api/v4/spot/candlesticks?currency_pair=BTC_USDT&interval=1m
 * Futures: GET /api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1m
 * Gate returns [[ ts, vol, close, high, low, open, amount ], ...] oldest first
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

  const pair = symbolToGatePair(symbol, exchangeType);
  if (!pair) {
    throw new Error(`Invalid symbol for Gate.io: ${symbol}`);
  }

  const hasBefore = before !== null && before !== undefined && before !== '' && Number.isFinite(Number(before)) && Number(before) > 0;
  const beforeKey = hasBefore ? String(Math.floor(Number(before))) : 'latest';
  const cacheKey = `gate_${symbol}_${exchangeType}_${interval}_${limit}_${beforeKey}`;
  const now = Date.now();
  if (klinesCache[cacheKey]?.timestamp && now - klinesCache[cacheKey].timestamp < KLINES_CACHE_TTL) {
    return klinesCache[cacheKey].data;
  }

  const isSecondInterval = ['1s', '5s', '15s'].includes(interval);
  const gateInterval = isSecondInterval ? '1m' : mapIntervalToGate(interval);
  const gateLimit = isSecondInterval ? { '1s': 50, '5s': 84, '15s': 125 }[interval] : limit;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let response;
      if (exchangeType === 'spot') {
        response = await axios.get(`${GATE_BASE_URL}/spot/candlesticks`, {
          params: {
            currency_pair: pair,
            interval: gateInterval,
            limit: gateLimit,
            ...(hasBefore ? { to: Math.floor(Number(before) / 1000) - 1 } : {}),
          },
          timeout: 10000,
        });
      } else {
        response = await axios.get(`${GATE_BASE_URL}/futures/usdt/candlesticks`, {
          params: {
            contract: pair,
            interval: gateInterval,
            limit: gateLimit,
            ...(hasBefore ? { to: Math.floor(Number(before) / 1000) - 1 } : {}),
          },
          timeout: 10000,
        });
      }

      // Debug: log response structure
      console.log(`[Gate.io] ${exchangeType} candlesticks response type:`, typeof response.data);
      console.log(`[Gate.io] ${exchangeType} response.data is array:`, Array.isArray(response.data));
      if (response.data) {
        console.log(`[Gate.io] ${exchangeType} response.data length:`, response.data.length || 'N/A');
        console.log(`[Gate.io] ${exchangeType} response.data keys:`, Object.keys(response.data).slice(0, 5));
      }

      const rawList = Array.isArray(response.data) ? response.data : [];
      
      // Log first candle for debugging
      if (rawList.length > 0) {
        console.log(`[Gate.io] First raw candle for ${pair}:`, JSON.stringify(rawList[0]));
      } else {
        console.warn(`[Gate.io] No candles returned for ${pair}`);
      }
      
      const klines = rawList.map((item, index) => {
        let tsSeconds, open, high, low, close, volume;
        
        // Handle both array format and object format
        if (Array.isArray(item)) {
          // Array format: [ ts, vol, close, high, low, open, amount ]
          if (item.length < 6) {
            console.error(`[Gate.io] Candle at index ${index} has insufficient length (${item.length}):`, item);
            throw new Error(`Invalid candle at index ${index}: expected at least 6 elements, got ${item.length}`);
          }
          // ts can be string or number
          tsSeconds = typeof item[0] === 'string' ? parseFloat(item[0]) : parseInt(item[0], 10);
          open = parseFloat(item[5]);
          high = parseFloat(item[3]);
          low = parseFloat(item[4]);
          close = parseFloat(item[2]);
          volume = parseFloat(item[1]) || 0;
        } else if (typeof item === 'object' && item !== null) {
          // Object format: { t: timestamp, o: open, h: high, l: low, c: close, v: volume }
          // Also handle { time, open, high, low, close, volume } format
          tsSeconds = parseFloat(item.t || item.time || item.timestamp);
          open = parseFloat(item.o || item.open);
          high = parseFloat(item.h || item.high);
          low = parseFloat(item.l || item.low);
          close = parseFloat(item.c || item.close);
          volume = parseFloat(item.v || item.volume || item.vol) || 0;
        } else {
          console.error(`[Gate.io] Candle at index ${index} is neither array nor object:`, item);
          throw new Error(`Invalid candle at index ${index}: unexpected format`);
        }
        
        if (!Number.isFinite(tsSeconds) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
          console.error(`[Gate.io] Invalid kline values at index ${index}:`, {
            tsSeconds, open, high, low, close, volume, rawItem: item
          });
          throw new Error(`Invalid kline at index ${index}: non-finite values`);
        }
        return { time: tsSeconds, open, high, low, close, volume };
      });

      // Gate returns oldest first (chronological) - already in correct order
      const finalKlines = isSecondInterval ? resample1mToSeconds(klines, interval) : klines;
      klinesCache[cacheKey] = { data: finalKlines, timestamp: now };
      console.log(`[Gate.io] Fetched ${finalKlines.length} klines for ${pair} (${interval})`);
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
      throw new Error(error.response?.data?.message || error.message || `Failed to fetch Gate.io klines for ${symbol}`);
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
  if (!token) throw new Error(`Token ${symbol} not found on Gate.io`);
  return token;
}

module.exports = {
  fetchTokensWithNATR,
  fetchTokenWithNATR,
  fetchKlines,
  calculateInstantNATR,
  symbolToGatePair,
  gatePairToFullSymbol,
  normalizeSymbol,
  getLastPricesBySymbols,
  fetchActiveSymbols,
};
