const axios = require('axios');

const OKX_BASE_URL = 'https://www.okx.com';

const CACHE_TTL = 300000; // 5 minutes
const cache = {
  futures: { data: null, timestamp: null },
  spot: { data: null, timestamp: null },
};
const klinesCache = {};
const KLINES_CACHE_TTL = 300000;

// Active instruments cache (same pattern as Binance exchangeInfo) – only show tradeable
const activeInstIdsCache = {
  futures: { instIds: null, meta: null, timestamp: null },
  spot: { instIds: null, meta: null, timestamp: null },
};
const ACTIVE_INST_IDS_CACHE_TTL = 3600000; // 1 hour

// Alert engine: last prices cache (short TTL, same as Binance/Bybit)
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
 * Normalize symbol to our format (uppercase, no separators) – same as Binance/Bybit.
 * e.g. "btc-usdt" -> "BTCUSDT"
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
 * Get last price per symbol from OKX tickers (for alert engine).
 * Same interface as binanceService.getLastPricesBySymbols. Keys in returned map are fullSymbol (e.g. BTCUSDT).
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
    console.warn(`[OKX getLastPricesBySymbols] ${exchangeType} failed:`, error.message);
    if (strict && hasRequestedSymbols) {
      const upstreamError = new Error(`OKX ${exchangeType} price feed unavailable: ${error.message}`);
      upstreamError.statusCode = error?.statusCode || error?.response?.status || 503;
      upstreamError.code = 'UPSTREAM_PRICE_UNAVAILABLE';
      throw upstreamError;
    }
    return {};
  }
}

/**
 * Fetch active USDT symbol set for "all coins" complex alerts (same as Binance/Bybit).
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
    const tokens = await fetchTickers(exchangeType);
    const symbols = new Set(
      tokens.filter((t) => t.fullSymbol && t.fullSymbol.endsWith('USDT')).map((t) => t.fullSymbol)
    );
    activeSymbolsCache[cacheKey].symbols = symbols;
    activeSymbolsCache[cacheKey].timestamp = now;
    console.log(`[OKX ${exchangeType.toUpperCase()}] Active USDT symbols: ${symbols.size}`);
    return symbols;
  } catch (error) {
    console.warn('[OKX] fetchActiveSymbols failed:', error.message);
    return null;
  }
}

/**
 * Calculate NATR approximation from 24h high/low/lastPrice (same as Binance/Bybit)
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
 * Convert our symbol (e.g. BTCUSDT) to OKX instId
 * Spot: BTC-USDT, Futures: BTC-USDT-SWAP
 */
function symbolToInstId(symbol, exchangeType) {
  const raw = typeof symbol === 'string' ? symbol.trim() : '';
  if (!raw) return null;

  // If we already have an OKX instId (e.g. BTC-USDT-SWAP, BTC-USD-SWAP, BTC-USD-250328), use it as-is.
  if (raw.includes('-')) {
    return raw.toUpperCase();
  }

  const base = raw.replace(/USDT$/i, '').trim();
  if (!base) return null;
  return exchangeType === 'spot'
    ? `${base}-USDT`
    : `${base}-USDT-SWAP`;
}

/**
 * Convert OKX instId to fullSymbol (BTCUSDT) for consistency with Binance/Bybit
 */
function instIdToFullSymbol(instId, exchangeType) {
  if (!instId) return null;
  if (exchangeType === 'futures') {
    // All USDT futures (SWAP or dated) → TOKENUSDT (e.g. BTC-USDT-SWAP → BTCUSDT, BTC-USDT-250328 → BTCUSDT)
    const usdtMatch = instId.match(/^([A-Z0-9]+)-USDT-/i);
    if (usdtMatch) return usdtMatch[1].toUpperCase() + 'USDT';
    return null; // non-USDT futures are excluded
  }
  if (exchangeType === 'spot' && instId.endsWith('-USDT')) {
    return instId.replace(/-/g, '');
  }
  return null;
}

/**
 * Get 24h volume in USDT – same meaning as Bybit turnover24h so sort order matches (BTC, ETH, SOL...).
 * Spot: prefer volCcy24h (quote in USDT), else base * lastPrice.
 * Futures (SWAP): always use base * lastPrice (vol24h is base currency; volCcy24h can be in other units for SWAP).
 */
function toUsdtVolume(vol24hBase, volCcy24h, lastPrice, isFutures, ctVal = null) {
  const base = Number(vol24hBase);
  const quote = Number(volCcy24h);
  const price = Number(lastPrice);
  if (isFutures) {
    // OKX derivatives: prefer volCcy24h (currency volume) * lastPrice when available.
    if (Number.isFinite(quote) && quote > 0 && Number.isFinite(price) && price > 0) {
      return quote * price;
    }
    // Fallback: vol24h is contract count, so multiply by contract value and last price.
    if (Number.isFinite(base) && base > 0 && Number.isFinite(ctVal) && ctVal > 0 && Number.isFinite(price) && price > 0) {
      return base * ctVal * price;
    }
    return null;
  }
  if (Number.isFinite(quote) && quote > 0) return quote;
  if (Number.isFinite(base) && Number.isFinite(price) && price > 0) return base * price;
  return null;
}

/**
 * Map our interval to OKX bar
 * OKX: 1m, 3m, 5m, 15m, 30m, 1H, 4H, 1D
 */
function mapIntervalToOkx(interval) {
  const map = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1H',
    '4h': '4H',
    '1d': '1D',
  };
  return map[interval] || '15m';
}

/**
 * Fetch active (live) instrument IDs from OKX – same idea as Binance exchangeInfo
 * OKX: GET /api/v5/public/instruments?instType=SPOT|SWAP, filter state === 'live', USDT only
 * @param {string} exchangeType - "futures" | "spot"
 * @returns {Promise<Set<string>|null>} Set of instId, or null if fetch fails
 */
async function fetchActiveInstIds(exchangeType) {
  const cacheKey = exchangeType;
  const now = Date.now();
  if (
    activeInstIdsCache[cacheKey].instIds &&
    activeInstIdsCache[cacheKey].timestamp &&
    now - activeInstIdsCache[cacheKey].timestamp < ACTIVE_INST_IDS_CACHE_TTL
  ) {
    return activeInstIdsCache[cacheKey].instIds;
  }

  try {
    const instTypes = exchangeType === 'futures' ? ['SWAP', 'FUTURES'] : ['SPOT'];
    const responses = await Promise.all(
      instTypes.map((instType) =>
        axios.get(`${OKX_BASE_URL}/api/v5/public/instruments`, {
          params: { instType },
          timeout: 10000,
        })
      )
    );

    for (const response of responses) {
      if (response.data?.code !== '0') {
        throw new Error(response.data?.msg || 'OKX API error');
      }
    }

    const instruments = responses.flatMap((response) => response.data?.data || []);
    const isFutures = exchangeType === 'futures';
    const instMeta = new Map();
    const activeInstIds = new Set(
      instruments
        .filter((inst) => {
          const state = (inst.state || '').toLowerCase();
          if (!inst.instId || (state && state !== 'live')) return false;
          if (isFutures) return inst.instId.includes('-USDT-'); // USDT pairs only
          return inst.instId.endsWith('-USDT') && !inst.instId.endsWith('-USDT-SWAP');
        })
        .map((inst) => {
          instMeta.set(inst.instId, {
            state: inst.state,
            instType: inst.instType,
            ctVal: Number(inst.ctVal),
          });
          return inst.instId;
        })
    );

    activeInstIdsCache[cacheKey].instIds = activeInstIds;
    activeInstIdsCache[cacheKey].meta = instMeta;
    activeInstIdsCache[cacheKey].timestamp = now;
    console.log(
      `[OKX ${exchangeType.toUpperCase()}] Found ${activeInstIds.size} active ${exchangeType === 'futures' ? 'instruments' : 'USDT instruments'}`
    );
    return activeInstIds;
  } catch (error) {
    console.warn(
      `[OKX ${exchangeType.toUpperCase()}] Failed to fetch instruments, using tickers only:`,
      error.message
    );
    return null;
  }
}

function getCachedInstMeta(exchangeType) {
  const cacheKey = exchangeType === 'futures' ? 'futures' : 'spot';
  return activeInstIdsCache[cacheKey].meta || null;
}

/**
 * Fetch all tickers for instType (SPOT or SWAP), filter to active USDT only, valid volume/price, add NATR
 * Same filtering logic as Binance: active symbols + USDT + volume > 0 + lastPrice > 0
 * OKX: GET /api/v5/market/tickers?instType=SPOT|SWAP
 * Response: data[] with instId, last, vol24h, volCcy24h, open24h, high24h, low24h
 */
async function fetchTickers(exchangeType, retries = 3) {
  const instTypes = exchangeType === 'futures' ? ['SWAP', 'FUTURES'] : ['SPOT'];

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const activeInstIds = await fetchActiveInstIds(exchangeType);
      const instMetaMap = getCachedInstMeta(exchangeType);

      const responses = await Promise.all(
        instTypes.map((instType) =>
          axios.get(`${OKX_BASE_URL}/api/v5/market/tickers`, {
            params: { instType },
            timeout: 15000,
          })
        )
      );

      for (const response of responses) {
        if (response.data?.code !== '0') {
          throw new Error(response.data?.msg || 'OKX API error');
        }
      }

      const list = responses.flatMap((response) => response.data?.data || []);
      const isFutures = exchangeType === 'futures';

      // Filter to active instruments
      const filtered = list.filter((t) => {
        if (!t.instId) return false;
        if (isFutures) {
          // USDT pairs only
          if (!t.instId.includes('-USDT-')) return false;
        } else {
          if (!t.instId.endsWith('-USDT') || t.instId.endsWith('-USDT-SWAP')) return false;
        }
        if (activeInstIds && !activeInstIds.has(t.instId)) return false;
        return true;
      });

      // For futures: dedup by base token, prefer SWAP (perpetual) ticker over dated futures
      let tickerList;
      if (isFutures) {
        const bestByBase = new Map(); // base -> ticker data
        for (const t of filtered) {
          const fullSymbol = instIdToFullSymbol(t.instId, exchangeType);
          if (!fullSymbol) continue;
          const existing = bestByBase.get(fullSymbol);
          const isSWAP = t.instId.endsWith('-SWAP');
          // Prefer SWAP (perpetual) – most liquid; keep first SWAP or first seen
          if (!existing || (isSWAP && !existing._isSWAP)) {
            bestByBase.set(fullSymbol, { ...t, _fullSymbol: fullSymbol, _isSWAP: isSWAP });
          }
        }
        tickerList = Array.from(bestByBase.values());
      } else {
        tickerList = filtered.map((t) => ({ ...t, _fullSymbol: instIdToFullSymbol(t.instId, exchangeType) }));
      }

      const tokens = tickerList.map((t) => {
        const meta = instMetaMap?.get(t.instId);
        const lastPrice = parseFloat(t.last);
        const open24h = parseFloat(t.open24h);
        const high24h = parseFloat(t.high24h);
        const low24h = parseFloat(t.low24h);
        const vol24hBase = parseFloat(t.vol24h);
        const volCcy24h = parseFloat(t.volCcy24h);
        const ctVal = meta?.ctVal;

        const normalizedLastPrice = Number.isFinite(lastPrice) && lastPrice > 0 ? Number(lastPrice) : null;
        const normalizedHigh24h = Number.isFinite(high24h) && high24h > 0 ? Number(high24h) : null;
        const normalizedLow24h = Number.isFinite(low24h) && low24h > 0 ? Number(low24h) : null;

        const fullSymbol = t._fullSymbol;
        const symbol = fullSymbol ? fullSymbol.replace('USDT', '') : t.instId.split('-')[0];

        let priceChangePercent24h = null;
        if (Number.isFinite(open24h) && open24h > 0 && normalizedLastPrice != null) {
          priceChangePercent24h = ((lastPrice - open24h) / open24h) * 100;
        }

        const volume24hRaw = toUsdtVolume(vol24hBase, volCcy24h, lastPrice, isFutures, ctVal);

        const token = {
          symbol: String(symbol),
          fullSymbol: String(fullSymbol || t.instId),
          lastPrice: normalizedLastPrice,
          volume24h: volume24hRaw != null && Number.isFinite(volume24hRaw) ? Number(volume24hRaw) : null,
          priceChangePercent24h: priceChangePercent24h != null && Number.isFinite(priceChangePercent24h) ? Number(priceChangePercent24h) : null,
          high24h: normalizedHigh24h,
          low24h: normalizedLow24h,
        };
        if (token.high24h != null && token.low24h != null && token.low24h > token.high24h) {
          token.high24h = null;
          token.low24h = null;
        }
        const natrVal = calculateInstantNATR(token);
        token.natr = natrVal != null && Number.isFinite(natrVal) ? Number(natrVal) : null;
        return token;
      });

      const dedupedTokens = tokens;

      const activeCount = activeInstIds ? activeInstIds.size : 'unknown';
      console.log(
        `[OKX ${exchangeType.toUpperCase()}] Active instruments: ${activeCount}, After filtering: ${dedupedTokens.length} tokens`
      );
      return dedupedTokens;
    } catch (error) {
      if (error.response?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[OKX] Rate limit, retrying in ${waitTime}ms...`);
        await wait(waitTime);
        continue;
      }
      if (!error.response && attempt < retries) {
        await wait(Math.pow(2, attempt) * 1000);
        continue;
      }
      console.error('[OKX] Error fetching tickers:', error.message);
      throw new Error(error.response?.data?.msg || error.message || 'Failed to fetch OKX tokens');
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
  const tokens = await fetchTickers(exchangeType);
  cache[cacheKey].data = tokens;
  cache[cacheKey].timestamp = now;
  return tokens;
}

/**
 * Resample 1m klines to second intervals (same as Binance/Bybit)
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
 * Fetch klines from OKX. Same output shape as Binance/Bybit: { time, open, high, low, close, volume }, time in seconds
 * OKX: GET /api/v5/market/candles?instId=...&bar=...&limit=...
 * OKX returns [ ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm ], newest first
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

  const instId = symbolToInstId(symbol, exchangeType);
  if (!instId) {
    throw new Error(`Invalid symbol for OKX: ${symbol}`);
  }

  const hasBefore = before !== null && before !== undefined && before !== '' && Number.isFinite(Number(before)) && Number(before) > 0;
  const beforeKey = hasBefore ? String(Math.floor(Number(before))) : 'latest';
  const cacheKey = `okx_${symbol}_${exchangeType}_${interval}_${limit}_${beforeKey}`;
  const now = Date.now();
  if (klinesCache[cacheKey]?.timestamp && now - klinesCache[cacheKey].timestamp < KLINES_CACHE_TTL) {
    return klinesCache[cacheKey].data;
  }

  // For second-level intervals, fetch 1m candles and resample after.
  const isSecondInterval = ['1s', '5s', '15s'].includes(interval);
  const okxBar = isSecondInterval ? '1m' : mapIntervalToOkx(interval);
  const okxLimit = isSecondInterval
    ? { '1s': 50, '5s': 84, '15s': 125 }[interval]
    : limit;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(`${OKX_BASE_URL}/api/v5/market/candles`, {
        params: {
          instId,
          bar: okxBar,
          limit: okxLimit,
          ...(hasBefore ? { after: Math.floor(Number(before)) - 1 } : {}),
        },
        timeout: 10000,
      });

      if (response.data?.code !== '0') {
        throw new Error(response.data?.msg || 'OKX API error');
      }

      const rawList = response.data?.data || [];
      const klines = rawList.map((arr, index) => {
        if (!Array.isArray(arr) || arr.length < 6) {
          throw new Error(`Invalid candle at index ${index}`);
        }
        const tsMs = parseInt(arr[0], 10);
        const time = Math.floor(tsMs / 1000);
        const open = parseFloat(arr[1]);
        const high = parseFloat(arr[2]);
        const low = parseFloat(arr[3]);
        const close = parseFloat(arr[4]);
        const volume = parseFloat(arr[5]) || 0;
        // arr[6] = volCcy (quote/USDT volume) – consistent unit across exchanges
        const turnover = parseFloat(arr[6]) || 0;
        if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
          throw new Error(`Invalid kline at index ${index}`);
        }
        return { time, open, high, low, close, volume, turnover };
      });

      // OKX returns newest first; we need chronological order
      klines.reverse();

      const finalKlines = isSecondInterval ? resample1mToSeconds(klines, interval) : klines;
      klinesCache[cacheKey] = { data: finalKlines, timestamp: now };
      console.log(`[OKX] Fetched ${finalKlines.length} klines for ${instId} (${interval})`);
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
      throw new Error(error.response?.data?.msg || error.message || `Failed to fetch OKX klines for ${symbol}`);
    }
  }
}

/**
 * Fetch single token details (same as Binance fetchTokenWithNATR)
 */
async function fetchTokenWithNATR(symbol, exchangeType) {
  const tokens = await fetchTokensWithNATR(exchangeType);
  const fullSymbol = (symbol || '').toUpperCase().replace('-', '');
  const token = tokens.find(
    (t) => t.fullSymbol === fullSymbol || t.fullSymbol === symbol
  );
  if (!token) throw new Error(`Token ${symbol} not found on OKX`);
  return token;
}

module.exports = {
  fetchTokensWithNATR,
  fetchTokenWithNATR,
  fetchKlines,
  calculateInstantNATR,
  symbolToInstId,
  instIdToFullSymbol,
  normalizeSymbol,
  getLastPricesBySymbols,
  fetchActiveSymbols,
};
