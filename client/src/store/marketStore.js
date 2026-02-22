// --- MEXC Futures Normalization ---
const normalizeMexcFuturesTokenMetrics = (token) => {
  if (!token || typeof token !== 'object') return token;
  // MEXC futures API: volume24h is in base units, amount is in quote (USDT), lastPrice is string
  const lastPrice = toNumericOrNull(token.lastPrice);
  const high24h = toNumericOrNull(token.high24h);
  const low24h = toNumericOrNull(token.low24h);
  const priceChangePercent24h = toNumericOrNull(token.priceChangePercent24h);
  // Prefer amount (quote/USDT) if available, else fallback to base*lastPrice
  let volume24h = toNumericOrNull(token.amount);
  if (!Number.isFinite(volume24h) || volume24h === 0) {
    const base = toNumericOrNull(token.volume24h);
    if (Number.isFinite(base) && Number.isFinite(lastPrice)) {
      volume24h = base * lastPrice;
    } else {
      volume24h = null;
    }
  }
  const normalized = {
    ...token,
    lastPrice,
    high24h,
    low24h,
    priceChangePercent24h,
    volume24h,
  };
  normalized.natr = calculateInstantNatr(normalized);
  return normalized;
};
// Bybit API endpoints
const BYBIT_BASE_URLS = [
  'https://api.bybit.com',
];

const mapIntervalToBybit = (interval) => {
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
};

const fetchBybitTokensDirect = async (exchangeType = 'futures', searchQuery = '') => {
  const category = exchangeType === 'futures' ? 'linear' : 'spot';
  let tokens = [];
  for (const baseUrl of BYBIT_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}/v5/market/tickers?category=${category}`);
      const data = await response.json();
      if (data?.retCode !== 0) throw new Error(data?.retMsg || 'Bybit API error');
      const list = data?.result?.list || [];
      const isFutures = exchangeType === 'futures';
      tokens = list
        .filter((t) => {
          if (!t.symbol) return false;
          if (isFutures) return true;
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
          token.natr = calculateInstantNatr(token);
          return token;
        });
      break;
    } catch (e) {}
  }
  if (searchQuery) {
    const searchLower = searchQuery.trim().toLowerCase();
    tokens = tokens.filter((token) =>
      token.symbol.toLowerCase().includes(searchLower) ||
      token.fullSymbol.toLowerCase().includes(searchLower)
    );
  }
  tokens.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
  return tokens;
};

const fetchBybitKlinesDirect = async (symbol, exchangeType = 'futures', interval = '15m', limit = CHART_PAGE_LIMIT, before = null) => {
  const category = exchangeType === 'futures' ? 'linear' : 'spot';
  const bybitInterval = mapIntervalToBybit(interval);
  const params = new URLSearchParams({
    category,
    symbol: symbol.toUpperCase(),
    interval: bybitInterval,
    limit: String(limit),
    ...(before ? { end: String(Math.floor(Number(before)) - 1) } : {}),
  });
  for (const baseUrl of BYBIT_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}/v5/market/kline?${params.toString()}`);
      const data = await response.json();
      if (data?.retCode !== 0) throw new Error(data?.retMsg || 'Bybit API error');
      const rawList = data?.result?.list || [];
      const klines = rawList.map((arr) => {
        const startTimeMs = parseInt(arr[0], 10);
        const time = Math.floor(startTimeMs / 1000);
        const open = parseFloat(arr[1]);
        const high = parseFloat(arr[2]);
        const low = parseFloat(arr[3]);
        const close = parseFloat(arr[4]);
        const volume = parseFloat(arr[5]) || 0;
        return { time, open, high, low, close, volume };
      });
      klines.reverse();
      return klines;
    } catch (e) {}
  }
  throw new Error('Failed to fetch Bybit klines');
};
import { create } from 'zustand';
import { marketService } from '../services/marketService';
import api from '../services/api';
import { API_BASE_URL } from '../utils/constants';

const CHART_PAGE_LIMIT = 500;
const WS_HISTORY_RECOVERY_COOLDOWN_MS = 5000;
const CROSS_EXCHANGE_FALLBACK_ORDER = ['okx', 'gate', 'bitget', 'mexc'];
const NATR14_PERIOD = 14;
const NATR14_INTERVAL = '5m';
const NATR14_KLINE_LIMIT = NATR14_PERIOD + 1;
const NATR14_CACHE_TTL_MS = 5 * 60 * 1000;
const NATR14_ENRICH_TOP_LIMIT = 60;
const NATR14_ENRICH_CONCURRENCY = 6;
const wsHistoryRecoveryAttemptBySeries = {};
const natr14CacheBySymbol = new Map();

const getChartHistoryKey = ({ exchange, exchangeType, symbol, interval }) => {
  return `${exchange}:${exchangeType}:${symbol}:${interval}`;
};

const getChartSeriesKey = ({ exchange, exchangeType, symbol, interval }) => {
  return `${exchange}:${exchangeType}:${symbol}:${interval}`;
};

const isSuspiciousInitialHistory = (klines) => {
  return !Array.isArray(klines) || klines.length <= 1;
};

const getKlineRangeSummary = (klines) => {
  if (!Array.isArray(klines) || klines.length === 0) {
    return {
      count: 0,
      firstTime: null,
      lastTime: null,
    };
  }

  return {
    count: klines.length,
    firstTime: Number(klines[0]?.time) || null,
    lastTime: Number(klines[klines.length - 1]?.time) || null,
  };
};

const logChartTelemetry = (event, payload) => {
  console.log(`[MarketStore][ChartTelemetry] ${event}`, payload);
};

const getRequestErrorSummary = (error) => {
  const responseData = error?.response?.data;
  return {
    message: error?.message || 'unknown_error',
    code: error?.code || null,
    status: error?.response?.status || null,
    statusText: error?.response?.statusText || null,
    hasResponse: !!error?.response,
    hasRequest: !!error?.request,
    responseError: typeof responseData?.error === 'string' ? responseData.error : null,
    responseMessage: typeof responseData?.message === 'string' ? responseData.message : null,
  };
};

// Allow ANY exchange to use cross-exchange chart fallback.
// This covers geo-blocked exchanges (Binance 451, Bybit 403 from Render) AND exchanges
// that simply lack historical data for a given symbol (e.g. new listings).
const canUseCrossExchangeChartFallback = (_exchange) => true;

const fetchKlinesFromCrossExchangeFallback = async ({
  primaryExchange,
  symbol,
  exchangeType,
  interval,
  limit,
  before = null,
  beforeSeconds = null,
}) => {
  const fallbackExchanges = CROSS_EXCHANGE_FALLBACK_ORDER.filter(
    (candidate) => candidate !== primaryExchange
  );

  for (const fallbackExchange of fallbackExchanges) {
    try {
      const params = new URLSearchParams({
        symbol,
        exchangeType,
        interval,
        limit: String(limit),
        ...(before ? { before: String(Math.floor(Number(before))) } : {}),
      });

      const response = await api.get(`/market/${fallbackExchange}/klines?${params.toString()}`);
      const klines = Array.isArray(response?.data?.klines) ? response.data.klines : [];

      if (!before) {
        if (klines.length > 0) {
          return {
            fallbackExchange,
            klines,
            olderKlines: klines,
            upstreamUnavailable: !!response?.data?.upstreamUnavailable,
          };
        }
        continue;
      }

      const olderKlines = Number.isFinite(beforeSeconds)
        ? klines.filter((kline) => Number(kline.time) < beforeSeconds)
        : [];

      if (olderKlines.length > 0) {
        return {
          fallbackExchange,
          klines,
          olderKlines,
          upstreamUnavailable: !!response?.data?.upstreamUnavailable,
        };
      }
    } catch {
      // Try next exchange candidate
    }
  }

  return null;
};

const getDirectKlineFallbackPolicy = (exchange, exchangeType) => {
  const useBinanceFutures = exchange === 'binance' && exchangeType === 'futures';
  const useBybit = exchange === 'bybit';
  const enabled = useBinanceFutures || useBybit;

  return {
    enabled,
    useBinanceFutures,
    useBybit,
    source: enabled ? (useBinanceFutures ? 'client_direct_futures' : 'client_direct_bybit') : null,
  };
};

const fetchDirectKlinesByPolicy = async ({
  policy,
  symbol,
  exchangeType,
  interval,
  limit,
  before = null,
}) => {
  if (!policy?.enabled) return [];

  if (policy.useBinanceFutures) {
    return fetchBinanceFuturesKlinesDirect(symbol, interval, limit, before);
  }

  if (policy.useBybit) {
    return fetchBybitKlinesDirect(symbol, exchangeType, interval, limit, before);
  }

  return [];
};

const shouldUseDirectFallbackAfterBackend = ({ mode, policy, upstreamUnavailable, klines, olderCount }) => {
  if (!policy?.enabled) return false;

  if (mode === 'initial') {
    return !!upstreamUnavailable || isSuspiciousInitialHistory(klines);
  }

  if (mode === 'history') {
    return !!upstreamUnavailable || Number(olderCount) === 0;
  }

  return false;
};

const getDirectFallbackReason = ({ mode, upstreamUnavailable }) => {
  if (upstreamUnavailable) return 'backend_upstream_unavailable';
  return mode === 'history' ? 'backend_no_older_candles' : 'backend_suspicious_short_history';
};

const mergeCandlesByTime = (olderCandles, currentCandles) => {
  const mergedMap = new Map();
  [...olderCandles, ...currentCandles].forEach((candle) => {
    if (!candle || !Number.isFinite(Number(candle.time))) return;
    mergedMap.set(Number(candle.time), candle);
  });
  return Array.from(mergedMap.values()).sort((left, right) => Number(left.time) - Number(right.time));
};

const BINANCE_FUTURES_BASE_URLS = [
  'https://fapi.binance.com/fapi/v1',
  'https://www.binance.com/fapi/v1',
];

const getBinanceFuturesProxyPaths = () => {
  const paths = [];
  if (typeof window !== 'undefined' && window.location?.origin) {
    paths.push(`${window.location.origin}/api/binance-klines`);
  }
  paths.push(`${API_BASE_URL.replace(/\/$/, '')}/binance-klines`);
  return paths;
};

const BINANCE_FUTURES_INTERVAL_MAP = {
  '1s': '1m',
  '5s': '1m',
  '15s': '1m',
};

const toNumericOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveUsdVolume24h = ({ quoteVolume, volume, lastPrice, weightedAvgPrice, volume24h }) => {
  const explicitUsdVolume = toNumericOrNull(volume24h);
  if (explicitUsdVolume != null) {
    return explicitUsdVolume;
  }

  const quote = toNumericOrNull(quoteVolume);
  if (quote != null && quote >= 0) {
    return quote;
  }

  const baseVolume = toNumericOrNull(volume);
  const priceRef = toNumericOrNull(weightedAvgPrice) ?? toNumericOrNull(lastPrice);
  if (baseVolume != null && priceRef != null) {
    const derived = baseVolume * priceRef;
    return Number.isFinite(derived) ? derived : null;
  }

  return null;
};

const normalizeMarketTokenMetrics = (token) => {
  if (!token || typeof token !== 'object') return token;

  const normalized = {
    ...token,
    lastPrice: toNumericOrNull(token.lastPrice),
    high24h: toNumericOrNull(token.high24h),
    low24h: toNumericOrNull(token.low24h),
    priceChangePercent24h: toNumericOrNull(token.priceChangePercent24h),
    volume24h: resolveUsdVolume24h({
      quoteVolume: token.quoteVolume,
      volume: token.volume,
      lastPrice: token.lastPrice,
      weightedAvgPrice: token.weightedAvgPrice,
      volume24h: token.volume24h,
    }),
  };

  normalized.natr = calculateInstantNatr(normalized);
  return normalized;
};

const calculateInstantNatr = (token) => {
  if (
    token.high24h == null ||
    token.low24h == null ||
    token.lastPrice == null ||
    token.lastPrice === 0
  ) {
    return null;
  }
  const natr = ((token.high24h - token.low24h) / token.lastPrice) * 100;
  return Number.isFinite(natr) ? Number(natr.toFixed(2)) : null;
};

const calculateNatr14FromKlines = (klines) => {
  if (!Array.isArray(klines) || klines.length < 2) return null;

  const trs = [];
  for (let index = 1; index < klines.length; index += 1) {
    const previousClose = Number(klines[index - 1]?.close);
    const high = Number(klines[index]?.high);
    const low = Number(klines[index]?.low);

    if (!Number.isFinite(previousClose) || !Number.isFinite(high) || !Number.isFinite(low)) {
      continue;
    }

    const tr = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );
    if (Number.isFinite(tr)) {
      trs.push(tr);
    }
  }

  if (trs.length === 0) return null;

  const recentTrs = trs.slice(-NATR14_PERIOD);
  const atr = recentTrs.reduce((sum, value) => sum + value, 0) / recentTrs.length;
  const lastClose = Number(klines[klines.length - 1]?.close);
  if (!Number.isFinite(atr) || !Number.isFinite(lastClose) || lastClose <= 0) {
    return null;
  }

  const natr = (atr / lastClose) * 100;
  return Number.isFinite(natr) ? Number(natr.toFixed(2)) : null;
};

const getCachedNatr14 = (fullSymbol) => {
  const cacheEntry = natr14CacheBySymbol.get(fullSymbol);
  if (!cacheEntry) return null;
  if (Date.now() - cacheEntry.timestamp > NATR14_CACHE_TTL_MS) {
    natr14CacheBySymbol.delete(fullSymbol);
    return null;
  }
  return cacheEntry.value;
};

const setCachedNatr14 = (fullSymbol, value) => {
  if (!Number.isFinite(value)) return;
  natr14CacheBySymbol.set(fullSymbol, {
    value,
    timestamp: Date.now(),
  });
};

const enrichTokensWithNatr14 = async (tokens) => {
  if (!Array.isArray(tokens) || tokens.length === 0) return tokens;

  const sortedByVolume = [...tokens].sort((left, right) => {
    const leftVol = Number.isFinite(Number(left?.volume24h)) ? Number(left.volume24h) : -1;
    const rightVol = Number.isFinite(Number(right?.volume24h)) ? Number(right.volume24h) : -1;
    return rightVol - leftVol;
  });

  const targetSymbols = sortedByVolume
    .slice(0, NATR14_ENRICH_TOP_LIMIT)
    .map((token) => token.fullSymbol)
    .filter((symbol) => typeof symbol === 'string' && symbol.length > 0);

  const queue = [...new Set(targetSymbols)];
  const workers = Array.from({ length: Math.min(NATR14_ENRICH_CONCURRENCY, queue.length) }, () => (async () => {
    while (queue.length > 0) {
      const fullSymbol = queue.shift();
      if (!fullSymbol) continue;

      const cachedNatr = getCachedNatr14(fullSymbol);
      if (cachedNatr != null) {
        const cachedToken = tokens.find((token) => token.fullSymbol === fullSymbol);
        if (cachedToken) cachedToken.natr = cachedNatr;
        continue;
      }

      try {
        const klines = await fetchBinanceFuturesKlinesDirect(
          fullSymbol,
          NATR14_INTERVAL,
          NATR14_KLINE_LIMIT
        );
        const natr14 = calculateNatr14FromKlines(klines);
        if (natr14 != null) {
          const tokenToUpdate = tokens.find((token) => token.fullSymbol === fullSymbol);
          if (tokenToUpdate) {
            tokenToUpdate.natr = natr14;
          }
          setCachedNatr14(fullSymbol, natr14);
        }
      } catch {
        // Keep fallback NATR value when 5m enrichment is unavailable.
      }
    }
  })());

  await Promise.all(workers);
  return tokens;
};

const resample1mToSeconds = (klines1m, secondInterval) => {
  const spanSeconds = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  const subPerMinute = 60 / spanSeconds;
  const result = [];

  for (const candle of klines1m) {
    const volumePerSub = candle.volume / subPerMinute;
    for (let index = 0; index < subPerMinute; index += 1) {
      result.push({
        time: candle.time + index * spanSeconds,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: volumePerSub,
      });
    }
  }

  return result;
};

const fetchJsonFromUrls = async (urls, endpoint, params = {}, validate = null) => {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `${endpoint}?${query.toString()}` : endpoint;
  let lastError = null;

  for (const baseUrl of urls) {
    try {
      const response = await fetch(`${baseUrl}${suffix}`, { method: 'GET' });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
      }
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Non-JSON response (${contentType || 'unknown'}) from ${baseUrl}${endpoint}: ${text.slice(0, 120)}`);
      }
      const data = await response.json();
      if (typeof validate === 'function' && !validate(data)) {
        throw new Error(`Invalid payload from ${baseUrl}${endpoint}`);
      }
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Failed all endpoints for ${endpoint}`);
};

const fetchBinanceFuturesTokensDirect = async (searchQuery = '') => {
  const prices = await fetchJsonFromUrls(
    BINANCE_FUTURES_BASE_URLS,
    '/ticker/price',
    {},
    (data) => Array.isArray(data)
  );

  let stats24h = [];
  try {
    const payload = await fetchJsonFromUrls(
      BINANCE_FUTURES_BASE_URLS,
      '/ticker/24hr',
      {},
      (data) => Array.isArray(data)
    );
    stats24h = Array.isArray(payload) ? payload : [];
  } catch {
    stats24h = [];
  }

  const priceList = Array.isArray(prices) ? prices : [];
  const statsMap = new Map(
    stats24h
      .filter((item) => typeof item?.symbol === 'string')
      .map((item) => [item.symbol, item])
  );

  const searchLower = searchQuery.trim().toLowerCase();

  const tokens = priceList
    .filter((ticker) => typeof ticker?.symbol === 'string' && ticker.symbol.endsWith('USDT'))
    .map((ticker) => {
      const stats = statsMap.get(ticker.symbol) || {};
      return normalizeMarketTokenMetrics({
        symbol: ticker.symbol.replace('USDT', ''),
        fullSymbol: ticker.symbol,
        lastPrice: ticker.price ?? stats.lastPrice,
        volume24h: stats.volume24h,
        quoteVolume: stats.quoteVolume,
        volume: stats.volume,
        weightedAvgPrice: stats.weightedAvgPrice,
        priceChangePercent24h: stats.priceChangePercent,
        high24h: stats.highPrice,
        low24h: stats.lowPrice,
      });
    })
    .filter((token) => {
      if (!searchLower) return true;
      return (
        token.symbol.toLowerCase().includes(searchLower) ||
        token.fullSymbol.toLowerCase().includes(searchLower)
      );
    });

  tokens.sort((left, right) => {
    const leftVol = Number.isFinite(left.volume24h) ? left.volume24h : -1;
    const rightVol = Number.isFinite(right.volume24h) ? right.volume24h : -1;
    return rightVol - leftVol;
  });

  await enrichTokensWithNatr14(tokens);

  if (tokens.length === 0) {
    throw new Error('Direct Binance Futures fetch returned empty token list');
  }

  return tokens;
};

const fetchBinanceFuturesKlinesDirect = async (
  symbol,
  interval = '15m',
  limit = CHART_PAGE_LIMIT,
  before = null
) => {
  const isSecondInterval = ['1s', '5s', '15s'].includes(interval);
  const apiInterval = BINANCE_FUTURES_INTERVAL_MAP[interval] || interval;
  const apiLimit = isSecondInterval
    ? { '1s': 50, '5s': 84, '15s': 125 }[interval]
    : limit;

  const requestParams = {
    symbol: String(symbol || '').toUpperCase(),
    interval: apiInterval,
    limit: String(apiLimit),
    ...(before ? { endTime: String(Math.floor(Number(before)) - 1) } : {}),
  };
  const shouldRejectShortInitialPayload = !before;
  const isSuspiciousShortPayload = (rows) =>
    shouldRejectShortInitialPayload && Array.isArray(rows) && rows.length <= 1;

  let rows;
  let usedProxy = false;

  try {
    const proxyQuery = new URLSearchParams(requestParams);
    const proxyPaths = getBinanceFuturesProxyPaths();

    for (const proxyPath of proxyPaths) {
      try {
        const proxyResponse = await fetch(`${proxyPath}?${proxyQuery.toString()}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!proxyResponse.ok) {
          const text = await proxyResponse.text();
          throw new Error(`Proxy HTTP ${proxyResponse.status}: ${text || proxyResponse.statusText}`);
        }

        const proxyPayload = await proxyResponse.json();
        if (!Array.isArray(proxyPayload?.klines)) {
          throw new Error('Proxy returned invalid klines payload');
        }

        if (isSuspiciousShortPayload(proxyPayload.klines)) {
          throw new Error('Proxy returned suspiciously short Binance Futures klines payload');
        }

        rows = proxyPayload.klines;
        usedProxy = true;
        break;
      } catch {
        // Try next proxy endpoint
      }
    }

    if (!rows) {
      throw new Error('All proxy endpoints failed');
    }
  } catch {
    rows = await fetchJsonFromUrls(
      BINANCE_FUTURES_BASE_URLS,
      '/klines',
      requestParams,
      (data) => {
        if (!Array.isArray(data)) return false;
        if (isSuspiciousShortPayload(data)) return false;
        return true;
      }
    );
  }

  const klines = (Array.isArray(rows) ? rows : [])
    .filter((row) => Array.isArray(row) && row.length >= 6)
    .map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.time) &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close) &&
        Number.isFinite(row.volume)
    );

  if (usedProxy) {
    logChartTelemetry('fetchBinanceFuturesKlinesDirect.proxyUsed', {
      symbol: String(symbol || '').toUpperCase(),
      interval,
      apiInterval,
      requestedLimit: limit,
      returnedCount: klines.length,
    });
  }

  if (isSuspiciousShortPayload(klines)) {
    throw new Error('Binance Futures direct klines returned suspiciously short history');
  }

  return isSecondInterval ? resample1mToSeconds(klines, interval) : klines;
};

export const useMarketStore = create((set, get) => ({
  coins: [],
  prices: {}, // Map of coinId -> price
  loading: false,
  error: null,

  // Market state (Binance + Bybit)
  binanceTokens: [],
  exchange: 'binance', // 'binance' | 'bybit' | 'okx' | 'gate' | 'bitget' | 'mexc'
  exchangeType: 'futures', // 'futures' | 'spot'
  searchQuery: '',
  loadingBinance: false,
  binanceError: null,
  activeTokensRequestId: null,
  selectedToken: null, // for token selection
  
  // Chart data state (single symbol for backward compat; multi-symbol in map)
  chartData: null,        // Array of candle data (last fetched, for selectedToken)
  chartDataMap: {},       // { [symbol]: kline[] } for multi-chart per-symbol data
  chartHistoryMap: {},    // { [exchange:exchangeType:symbol:interval]: { earliestTime, hasMoreHistory, loadingOlder } }
  loadingChart: false,   // Loading state
  chartError: null,       // Error message
  
  // Real-time subscription state
  activeSubscription: null, // { exchange, symbol, interval, exchangeType }
  isRealtimeConnected: false, // WebSocket connection status

  // Watchlist state
  watchlists: JSON.parse(localStorage.getItem('watchlists') || '[]'), // Array of { id, name, tokens: [] }
  selectedWatchlist: null, // Currently selected watchlist ID

  fetchCoins: async () => {
    set({ loading: true, error: null });
    try {
      const data = await marketService.getCoins();
      // Initialize prices from fetched coins if available
      const initialPrices = {};
      data.forEach(coin => {
          if (coin.current_price) {
              initialPrices[coin.id] = coin.current_price;
          }
      });
      
      set({ coins: data, prices: initialPrices, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },

  searchCoins: async (query) => {
    set({ loading: true, error: null });
    try {
      const data = await marketService.searchCoins(query);
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  updatePrice: (coinId, price) => {
    set((state) => ({
      prices: {
        ...state.prices,
        [coinId]: price
      }
    }));
  },

  // New actions
  setExchange: (exchange) => set({ exchange }),
  setExchangeType: (type) => set({ exchangeType: type }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedToken: (token) => set({ selectedToken: token }),

  fetchBinanceTokens: async (exchangeType, searchQuery = '', retryCount = 0, requestId = null) => {
    const exchange = get().exchange;
    const activeRequestId = requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (retryCount === 0) {
      set({ loadingBinance: true, binanceError: null, activeTokensRequestId: activeRequestId });
    }

    const isLatestRequest = () => get().activeTokensRequestId === activeRequestId;
    const applyIfLatest = (patch) => {
      if (isLatestRequest()) {
        set(patch);
      }
    };

    const useDirectFuturesClientFallback = exchange === 'binance' && exchangeType === 'futures';
    const useDirectBybitClientFallback = exchange === 'bybit';

    const isCORSError = (error) => {
      return error.message?.includes('CORS') ||
        error.message?.includes('cross-origin') ||
        (error.response?.status === 0 && error.message?.includes('Network'));
    };

    const isRetryableError = (error) => {
      if (error.response?.status >= 400) return false;
      return error.code === 'ERR_NETWORK' ||
        error.code === 'ECONNREFUSED' ||
        error.message?.includes('Failed to fetch') ||
        error.message?.includes('Network') ||
        !error.response;
    };

    try {
      if (useDirectBybitClientFallback) {
        try {
          const params = new URLSearchParams({
            exchangeType,
            ...(searchQuery && { search: searchQuery })
          });
          const url = `/market/${exchange}/tokens?${params}`;
          let response = await api.get(url);
          if (!response.data || !Array.isArray(response.data.tokens) || response.data.tokens.length === 0) {
            const directTokens = await fetchBybitTokensDirect(exchangeType, searchQuery);
            response = {
              data: {
                tokens: directTokens,
                exchangeType,
                totalCount: directTokens.length,
                source: 'bybit-client-direct',
              },
              status: 200,
            };
          }
          const normalizedTokens = Array.isArray(response.data.tokens)
            ? response.data.tokens.map((token) => normalizeMarketTokenMetrics(token))
            : [];
          applyIfLatest({
            binanceTokens: normalizedTokens,
            loadingBinance: false,
            binanceError: null
          });
          return;
        } catch {
          const directTokens = await fetchBybitTokensDirect(exchangeType, searchQuery);
          applyIfLatest({
            binanceTokens: directTokens,
            loadingBinance: false,
            binanceError: null
          });
          return;
        }
      }

      const params = new URLSearchParams({
        exchangeType,
        ...(searchQuery && { search: searchQuery })
      });
      const url = `/market/${exchange}/tokens?${params}`;
      let response;
      try {
        response = await api.get(url);
        const backendReturnedNoFutures =
          useDirectFuturesClientFallback &&
          (
            response.data?.upstreamUnavailable ||
            !Array.isArray(response.data.tokens) ||
            response.data.tokens.length === 0
          );
        if (backendReturnedNoFutures) {
          const directTokens = await fetchBinanceFuturesTokensDirect(searchQuery);
          response = {
            ...response,
            data: {
              tokens: directTokens,
              exchangeType,
              totalCount: directTokens.length,
              source: 'binance-futures-client-direct',
            },
          };
        }
      } catch (axiosError) {
        if (isCORSError(axiosError)) {
          throw new Error('CORS error: Backend CORS configuration issue. Please check server CORS settings.');
        }
        if (isRetryableError(axiosError) && retryCount === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return get().fetchBinanceTokens(exchangeType, searchQuery, retryCount + 1, activeRequestId);
        }
        if (useDirectFuturesClientFallback) {
          const directTokens = await fetchBinanceFuturesTokensDirect(searchQuery);
          response = {
            data: {
              tokens: directTokens,
              exchangeType,
              totalCount: directTokens.length,
              source: 'binance-futures-client-direct',
            },
            status: 200,
          };
        } else {
          throw axiosError;
        }
      }
      let normalizedTokens = Array.isArray(response.data.tokens)
        ? response.data.tokens.map((token) => {
            if (exchange === 'mexc' && exchangeType === 'futures') {
              return normalizeMexcFuturesTokenMetrics(token);
            }
            return normalizeMarketTokenMetrics(token);
          })
        : [];
      applyIfLatest({
        binanceTokens: normalizedTokens,
        loadingBinance: false,
        binanceError: null
      });
    } catch (error) {
      let errorMessage = 'Failed to fetch tokens';
      if (isCORSError(error) || error.message?.includes('CORS')) {
        errorMessage = 'CORS error: Backend CORS configuration issue. Please check server CORS settings.';
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK' || error.message.includes('Failed to fetch')) {
        errorMessage = 'Cannot connect to server. Please ensure the backend is running on port 5000.';
      } else if (error.response) {
        errorMessage = error.response.data?.error || `Server error: ${error.response.status}`;
      } else if (error.request) {
        errorMessage = 'No response from server. Check if backend is running.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      applyIfLatest({
        binanceError: errorMessage,
        loadingBinance: false,
        binanceTokens: []
      });
    }
  },
  
  fetchChartData: async (symbol, exchangeType, interval = '15m') => {
    set({ loadingChart: true, chartError: null });
    const exchange = get().exchange;
    const historyKey = getChartHistoryKey({ exchange, exchangeType, symbol, interval });
    const seriesKey = getChartSeriesKey({ exchange, exchangeType, symbol, interval });
    const directPolicy = getDirectKlineFallbackPolicy(exchange, exchangeType);

    const applyKlinesToState = (klines) => {
      const earliestTime = klines.length > 0 ? Number(klines[0].time) : null;
      set((state) => ({
        chartData: klines,
        chartDataMap: { ...state.chartDataMap, [seriesKey]: klines },
        chartHistoryMap: {
          ...state.chartHistoryMap,
          [historyKey]: {
            earliestTime,
            hasMoreHistory: klines.length > 0, // true as long as we have any data; chart stops when next page returns empty
            loadingOlder: false,
          },
        },
        loadingChart: false,
        chartError: null
      }));
    };

    try {
      let directKlines = [];
      if (directPolicy.enabled) {
        try {
          directKlines = await fetchDirectKlinesByPolicy({
            policy: directPolicy,
            symbol,
            exchangeType,
            interval,
            limit: CHART_PAGE_LIMIT,
          });
          logChartTelemetry('fetchChartData.directPrimaryResponse', {
            exchange,
            exchangeType,
            symbol,
            interval,
            source: directPolicy.source,
            ...getKlineRangeSummary(directKlines),
          });
          if (Array.isArray(directKlines) && directKlines.length >= 20) {
            logChartTelemetry('fetchChartData.finalSelection', {
              exchange,
              exchangeType,
              symbol,
              interval,
              seriesKey,
              source: `${directPolicy.source}_primary`,
              ...getKlineRangeSummary(directKlines),
            });
            applyKlinesToState(directKlines);
            return;
          }
        } catch {
          directKlines = [];
          logChartTelemetry('fetchChartData.directPrimaryFailed', {
            exchange,
            exchangeType,
            symbol,
            interval,
            source: directPolicy.source,
          });
        }
      }

      const params = new URLSearchParams({
        symbol,
        exchangeType,
        interval,
        limit: String(CHART_PAGE_LIMIT)
      });
      const response = await api.get(`/market/${exchange}/klines?${params}`);
      if (!response.data?.klines || !Array.isArray(response.data.klines)) {
        throw new Error('Invalid chart data format');
      }
      let klines = response.data.klines;
      const backendSummary = getKlineRangeSummary(klines);
      logChartTelemetry('fetchChartData.backendResponse', {
        exchange,
        exchangeType,
        symbol,
        interval,
        source: 'backend',
        upstreamUnavailable: !!response.data?.upstreamUnavailable,
        ...backendSummary,
      });
      if (shouldUseDirectFallbackAfterBackend({
        mode: 'initial',
        policy: directPolicy,
        upstreamUnavailable: response.data?.upstreamUnavailable,
        klines,
      })) {
        const fallbackReason = getDirectFallbackReason({
          mode: 'initial',
          upstreamUnavailable: response.data?.upstreamUnavailable,
        });
        try {
          const directKlinesFallback = await fetchDirectKlinesByPolicy({
            policy: directPolicy,
            symbol,
            exchangeType,
            interval,
            limit: CHART_PAGE_LIMIT,
          });
          const directSummary = getKlineRangeSummary(directKlinesFallback);
          logChartTelemetry('fetchChartData.directFallbackResponse', {
            exchange,
            exchangeType,
            symbol,
            interval,
            source: directPolicy.source,
            fallbackReason,
            ...directSummary,
          });
          if (Array.isArray(directKlinesFallback) && directKlinesFallback.length > klines.length) {
            klines = directKlinesFallback;
          }
        } catch {
          logChartTelemetry('fetchChartData.directFallbackFailed', {
            exchange,
            exchangeType,
            symbol,
            interval,
            source: directPolicy.source,
            fallbackReason,
          });
        }
      }
      if (directPolicy.enabled && Array.isArray(directKlines) && directKlines.length > klines.length) {
        klines = directKlines;
      }

      if (
        canUseCrossExchangeChartFallback(exchange) &&
        isSuspiciousInitialHistory(klines)
      ) {
        const crossFallback = await fetchKlinesFromCrossExchangeFallback({
          primaryExchange: exchange,
          symbol,
          exchangeType,
          interval,
          limit: CHART_PAGE_LIMIT,
        });

        if (crossFallback && Array.isArray(crossFallback.klines) && crossFallback.klines.length > klines.length) {
          klines = crossFallback.klines;
          logChartTelemetry('fetchChartData.crossExchangeFallbackSelection', {
            exchange,
            exchangeType,
            symbol,
            interval,
            fromExchange: exchange,
            selectedExchange: crossFallback.fallbackExchange,
            seriesKey,
            ...getKlineRangeSummary(klines),
          });
        }
      }

      logChartTelemetry('fetchChartData.finalSelection', {
        exchange,
        exchangeType,
        symbol,
        interval,
        seriesKey,
        ...getKlineRangeSummary(klines),
      });
      applyKlinesToState(klines);
    } catch (error) {
      logChartTelemetry('fetchChartData.backendError', {
        exchange,
        exchangeType,
        symbol,
        interval,
        source: 'backend',
        message: error?.message || 'unknown_error',
      });
      if (directPolicy.enabled) {
        try {
          const klines = await fetchDirectKlinesByPolicy({
            policy: directPolicy,
            symbol,
            exchangeType,
            interval,
            limit: CHART_PAGE_LIMIT,
          });
          logChartTelemetry('fetchChartData.directRecoverySelection', {
            exchange,
            exchangeType,
            symbol,
            interval,
            source: directPolicy.source,
            ...getKlineRangeSummary(klines),
          });
          applyKlinesToState(klines);
          return;
        } catch {
          logChartTelemetry('fetchChartData.directRecoveryFailed', {
            exchange,
            exchangeType,
            symbol,
            interval,
            source: directPolicy.source,
          });
        }
      }

      if (canUseCrossExchangeChartFallback(exchange)) {
        const crossFallback = await fetchKlinesFromCrossExchangeFallback({
          primaryExchange: exchange,
          symbol,
          exchangeType,
          interval,
          limit: CHART_PAGE_LIMIT,
        });

        if (crossFallback && Array.isArray(crossFallback.klines) && crossFallback.klines.length > 0) {
          logChartTelemetry('fetchChartData.crossExchangeRecoverySelection', {
            exchange,
            exchangeType,
            symbol,
            interval,
            fromExchange: exchange,
            selectedExchange: crossFallback.fallbackExchange,
            seriesKey,
            ...getKlineRangeSummary(crossFallback.klines),
          });
          applyKlinesToState(crossFallback.klines);
          return;
        }
      }

      const errorMessage = error.response?.data?.error ||
        error.message ||
        'Failed to fetch chart data';
      set({
        chartError: errorMessage,
        loadingChart: false,
        chartData: null
      });
    }
  },

  loadOlderChartData: async (symbol, exchangeType, interval = '15m', beforeTimestampMs) => {
    const exchange = get().exchange;
    const historyKey = getChartHistoryKey({ exchange, exchangeType, symbol, interval });
    const seriesKey = getChartSeriesKey({ exchange, exchangeType, symbol, interval });
    const directPolicy = getDirectKlineFallbackPolicy(exchange, exchangeType);
    const historyMeta = get().chartHistoryMap[historyKey] || {
      earliestTime: null,
      hasMoreHistory: true,
      loadingOlder: false,
    };

    if (historyMeta.loadingOlder) {
      return [];
    }

    const beforeTimestamp = Number(beforeTimestampMs);
    if (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0) {
      return [];
    }

    set((state) => ({
      chartHistoryMap: {
        ...state.chartHistoryMap,
        [historyKey]: {
          ...(state.chartHistoryMap[historyKey] || historyMeta),
          loadingOlder: true,
        },
      },
    }));

    try {
      const beforeSeconds = Math.floor(beforeTimestamp / 1000);
      const params = new URLSearchParams({
        symbol,
        exchangeType,
        interval,
        limit: String(CHART_PAGE_LIMIT),
        before: String(Math.floor(beforeTimestamp)),
      });
      const requestPath = `/market/${exchange}/klines?${params.toString()}`;

      logChartTelemetry('loadOlderChartData.requestStart', {
        exchange,
        exchangeType,
        symbol,
        interval,
        beforeTimestamp,
        beforeSeconds,
        requestPath,
        source: 'backend',
        directRecoveryEnabled: directPolicy.enabled,
      });

      const response = await api.get(requestPath);
      let fetchedKlines = Array.isArray(response.data?.klines) ? response.data.klines : [];
      let olderKlines = fetchedKlines.filter((kline) => Number(kline.time) < beforeSeconds);

      logChartTelemetry('loadOlderChartData.backendResponse', {
        exchange,
        exchangeType,
        symbol,
        interval,
        beforeTimestamp,
        source: 'backend',
        requestPath,
        status: response?.status || null,
        upstreamUnavailable: !!response.data?.upstreamUnavailable,
        fetched: getKlineRangeSummary(fetchedKlines),
        older: getKlineRangeSummary(olderKlines),
      });

      if (shouldUseDirectFallbackAfterBackend({
        mode: 'history',
        policy: directPolicy,
        upstreamUnavailable: response.data?.upstreamUnavailable,
        olderCount: olderKlines.length,
      })) {
        const fallbackReason = getDirectFallbackReason({
          mode: 'history',
          upstreamUnavailable: response.data?.upstreamUnavailable,
        });
        try {
          const directFetched = await fetchDirectKlinesByPolicy({
            policy: directPolicy,
            symbol,
            exchangeType,
            interval,
            limit: CHART_PAGE_LIMIT,
            before: beforeTimestamp,
          });
          const directOlder = directFetched.filter((kline) => Number(kline.time) < beforeSeconds);
          logChartTelemetry('loadOlderChartData.directFallbackResponse', {
            exchange,
            exchangeType,
            symbol,
            interval,
            beforeTimestamp,
            source: directPolicy.source,
            fallbackReason,
            fetched: getKlineRangeSummary(directFetched),
            older: getKlineRangeSummary(directOlder),
          });
          if (directOlder.length > olderKlines.length) {
            fetchedKlines = directFetched;
            olderKlines = directOlder;
          }
        } catch {
          logChartTelemetry('loadOlderChartData.directFallbackFailed', {
            exchange,
            exchangeType,
            symbol,
            interval,
            beforeTimestamp,
            source: directPolicy.source,
            fallbackReason,
          });
          // keep backend older data
        }
      }

      // Cross-exchange fallback for ALL exchanges: whenever primary returned no older candles,
      // try OKX → Gate → Bitget → MEXC (skipping the primary exchange itself).
      if (olderKlines.length === 0) {
        const crossFallback = await fetchKlinesFromCrossExchangeFallback({
          primaryExchange: exchange,
          symbol,
          exchangeType,
          interval,
          limit: CHART_PAGE_LIMIT,
          before: beforeTimestamp,
          beforeSeconds,
        });

        if (
          crossFallback &&
          Array.isArray(crossFallback.olderKlines) &&
          crossFallback.olderKlines.length > olderKlines.length
        ) {
          fetchedKlines = crossFallback.klines;
          olderKlines = crossFallback.olderKlines;
          logChartTelemetry('loadOlderChartData.crossExchangeFallbackSelection', {
            exchange,
            exchangeType,
            symbol,
            interval,
            beforeTimestamp,
            beforeSeconds,
            fromExchange: exchange,
            selectedExchange: crossFallback.fallbackExchange,
            fetched: getKlineRangeSummary(fetchedKlines),
            older: getKlineRangeSummary(olderKlines),
          });
        }
      }

      set((state) => {
        const currentData = state.chartDataMap[seriesKey] || state.chartData || [];
        const merged = mergeCandlesByTime(olderKlines, currentData);
        const earliestTime = merged.length > 0 ? Number(merged[0].time) : null;
        // hasMoreHistory: true as long as we received any older candles.
        // Avoid relying on fetchedKlines.length >= CHART_PAGE_LIMIT because some exchanges
        // (e.g. OKX) cap responses at 300 even when CHART_PAGE_LIMIT=500.
        const hasMoreHistory = olderKlines.length > 0;
        const isSelectedSymbol = state.selectedToken?.fullSymbol === symbol;

        return {
          ...(isSelectedSymbol && { chartData: merged }),
          chartDataMap: { ...state.chartDataMap, [seriesKey]: merged },
          chartHistoryMap: {
            ...state.chartHistoryMap,
            [historyKey]: {
              earliestTime,
              hasMoreHistory,
              loadingOlder: false,
            },
          },
        };
      });

      logChartTelemetry('loadOlderChartData.finalMerge', {
        exchange,
        exchangeType,
        symbol,
        interval,
        beforeTimestamp,
        seriesKey,
        selectedOlder: getKlineRangeSummary(olderKlines),
      });

      return olderKlines;
    } catch (error) {
      const beforeSeconds = Math.floor(beforeTimestamp / 1000);
      const params = new URLSearchParams({
        symbol,
        exchangeType,
        interval,
        limit: String(CHART_PAGE_LIMIT),
        before: String(Math.floor(beforeTimestamp)),
      });
      const requestPath = `/market/${exchange}/klines?${params.toString()}`;
      const requestError = getRequestErrorSummary(error);

      logChartTelemetry('loadOlderChartData.failed', {
        exchange,
        exchangeType,
        symbol,
        interval,
        beforeTimestamp,
        beforeSeconds,
        requestPath,
        source: 'backend',
        ...requestError,
      });

      if (directPolicy.enabled) {
        const directSource = directPolicy.source;

        try {
          const directFetched = await fetchDirectKlinesByPolicy({
            policy: directPolicy,
            symbol,
            exchangeType,
            interval,
            limit: CHART_PAGE_LIMIT,
            before: beforeTimestamp,
          });

          const directOlder = directFetched.filter((kline) => Number(kline.time) < beforeSeconds);
          logChartTelemetry('loadOlderChartData.directRecoveryResponse', {
            exchange,
            exchangeType,
            symbol,
            interval,
            beforeTimestamp,
            beforeSeconds,
            source: directSource,
            recoveryReason: 'backend_request_failed',
            fetched: getKlineRangeSummary(directFetched),
            older: getKlineRangeSummary(directOlder),
          });

          if (directOlder.length > 0) {
            set((state) => {
              const currentData = state.chartDataMap[seriesKey] || state.chartData || [];
              const merged = mergeCandlesByTime(directOlder, currentData);
              const earliestTime = merged.length > 0 ? Number(merged[0].time) : null;
              const hasMoreHistory = directOlder.length > 0;
              const isSelectedSymbol = state.selectedToken?.fullSymbol === symbol;

              return {
                ...(isSelectedSymbol && { chartData: merged }),
                chartDataMap: { ...state.chartDataMap, [seriesKey]: merged },
                chartHistoryMap: {
                  ...state.chartHistoryMap,
                  [historyKey]: {
                    earliestTime,
                    hasMoreHistory,
                    loadingOlder: false,
                  },
                },
              };
            });

            logChartTelemetry('loadOlderChartData.directRecoveryMerge', {
              exchange,
              exchangeType,
              symbol,
              interval,
              beforeTimestamp,
              beforeSeconds,
              seriesKey,
              source: directSource,
              selectedOlder: getKlineRangeSummary(directOlder),
            });

            return directOlder;
          }
        } catch (directError) {
          logChartTelemetry('loadOlderChartData.directRecoveryFailed', {
            exchange,
            exchangeType,
            symbol,
            interval,
            beforeTimestamp,
            beforeSeconds,
            source: directSource,
            recoveryReason: 'backend_request_failed',
            ...getRequestErrorSummary(directError),
          });
        }
      }

      if (canUseCrossExchangeChartFallback(exchange)) {
        const crossFallback = await fetchKlinesFromCrossExchangeFallback({
          primaryExchange: exchange,
          symbol,
          exchangeType,
          interval,
          limit: CHART_PAGE_LIMIT,
          before: beforeTimestamp,
          beforeSeconds,
        });

        if (crossFallback && Array.isArray(crossFallback.olderKlines) && crossFallback.olderKlines.length > 0) {
          set((state) => {
            const currentData = state.chartDataMap[seriesKey] || state.chartData || [];
            const merged = mergeCandlesByTime(crossFallback.olderKlines, currentData);
            const earliestTime = merged.length > 0 ? Number(merged[0].time) : null;
            const hasMoreHistory = crossFallback.olderKlines.length > 0;
            const isSelectedSymbol = state.selectedToken?.fullSymbol === symbol;

            return {
              ...(isSelectedSymbol && { chartData: merged }),
              chartDataMap: { ...state.chartDataMap, [seriesKey]: merged },
              chartHistoryMap: {
                ...state.chartHistoryMap,
                [historyKey]: {
                  earliestTime,
                  hasMoreHistory,
                  loadingOlder: false,
                },
              },
            };
          });

          logChartTelemetry('loadOlderChartData.crossExchangeRecoveryMerge', {
            exchange,
            exchangeType,
            symbol,
            interval,
            beforeTimestamp,
            beforeSeconds,
            fromExchange: exchange,
            selectedExchange: crossFallback.fallbackExchange,
            seriesKey,
            selectedOlder: getKlineRangeSummary(crossFallback.olderKlines),
          });

          return crossFallback.olderKlines;
        }
      }

      set((state) => ({
        chartHistoryMap: {
          ...state.chartHistoryMap,
          [historyKey]: {
            ...(state.chartHistoryMap[historyKey] || historyMeta),
            loadingOlder: false,
          },
        },
      }));

      return [];
    }
  },

  getChartHistoryMeta: (symbol, exchangeType, interval = '15m') => {
    const exchange = get().exchange;
    const historyKey = getChartHistoryKey({ exchange, exchangeType, symbol, interval });
    return get().chartHistoryMap[historyKey] || {
      earliestTime: null,
      hasMoreHistory: true,
      loadingOlder: false,
    };
  },

  getChartDataForSymbol: (symbol, exchangeType, interval = '15m') => {
    const exchange = get().exchange;
    const seriesKey = getChartSeriesKey({ exchange, exchangeType, symbol, interval });
    return get().chartDataMap[seriesKey] ?? get().chartDataMap[symbol] ?? null;
  },

  // Subscribe to real-time kline updates
  subscribeToKline: (socket, exchange, symbol, interval, exchangeType) => {
    console.log('[MarketStore] 🔔 subscribeToKline called:', {
      exchange,
      symbol,
      interval,
      exchangeType,
      hasSocket: !!socket,
      socketId: socket?.id
    });

    if (!socket) {
      console.error('[MarketStore] ❌ Cannot subscribe: socket not available');
      return;
    }

    // Unsubscribe from previous subscription if exists
    const currentSub = get().activeSubscription;
    if (currentSub) {
      console.log('[MarketStore] 🔄 Unsubscribing from previous:', currentSub);
      socket.unsubscribeKline(
        currentSub.exchange,
        currentSub.symbol,
        currentSub.interval,
        currentSub.exchangeType
      );
    }

    // Subscribe to new kline stream
    const subscription = { exchange, symbol, interval, exchangeType };
    console.log('[MarketStore] 📤 Calling socket.subscribeKline...');
    socket.subscribeKline(exchange, symbol, interval, exchangeType);
    
    set({ 
      activeSubscription: subscription,
      isRealtimeConnected: true 
    });

    console.log('[MarketStore] ✅ Subscription state updated:', subscription);
  },

  // Unsubscribe from kline updates
  unsubscribeFromKline: (socket) => {
    const sub = get().activeSubscription;
    if (!sub || !socket) {
      return;
    }

    socket.unsubscribeKline(sub.exchange, sub.symbol, sub.interval, sub.exchangeType);
    
    set({ 
      activeSubscription: null,
      isRealtimeConnected: false 
    });

    console.log('[MarketStore] Unsubscribed from kline:', sub);
  },

  // Handle incoming kline update from WebSocket
  handleKlineUpdate: (updateData) => {
    console.log('[MarketStore] 📨 handleKlineUpdate called:', {
      exchange: updateData.exchange,
      symbol: updateData.symbol,
      interval: updateData.interval,
      exchangeType: updateData.exchangeType,
      close: updateData.kline?.close,
      time: updateData.kline?.time,
      timeISO: updateData.kline?.time ? new Date(updateData.kline.time * 1000).toISOString() : 'N/A',
      isClosed: updateData.kline?.isClosed
    });

    const { exchange, symbol, interval, exchangeType, kline } = updateData;
    const currentSub = get().activeSubscription;
    
    console.log('[MarketStore] 🔍 Current subscription:', currentSub);
    
    // Verify it matches current subscription
    if (!currentSub || 
        currentSub.exchange !== exchange ||
        currentSub.symbol !== symbol ||
        currentSub.interval !== interval ||
        currentSub.exchangeType !== exchangeType) {
      console.warn('[MarketStore] ❌ Update does not match active subscription, ignoring:', {
        received: { exchange, symbol, interval, exchangeType },
        expected: currentSub
      });
      return;
    }
    
    console.log('[MarketStore] ✅ Update matches subscription, applying to chartData');

    const seriesKey = getChartSeriesKey({ exchange, exchangeType, symbol, interval });
    const existingSeries = get().chartDataMap[seriesKey] || [];
    if (existingSeries.length <= 1) {
      const now = Date.now();
      const lastAttempt = wsHistoryRecoveryAttemptBySeries[seriesKey] || 0;
      if (now - lastAttempt > WS_HISTORY_RECOVERY_COOLDOWN_MS) {
        wsHistoryRecoveryAttemptBySeries[seriesKey] = now;
        logChartTelemetry('handleKlineUpdate.recoveryFetchRequested', {
          exchange,
          exchangeType,
          symbol,
          interval,
          seriesKey,
          existingCount: existingSeries.length,
        });
        Promise.resolve(get().fetchChartData(symbol, exchangeType, interval)).catch(() => {
          logChartTelemetry('handleKlineUpdate.recoveryFetchFailed', {
            exchange,
            exchangeType,
            symbol,
            interval,
            seriesKey,
          });
        });
      }
    }
    
    // Update chartData and chartDataMap[seriesKey] - append or update last candle
    set((state) => {
      const currentData = state.chartData || [];
      const currentMapData = state.chartDataMap[seriesKey] || [];
      const dataToUpdate = currentMapData.length > 0 ? currentMapData : currentData;
      const newCandle = kline;
      const isBinanceFutures = exchange === 'binance' && exchangeType === 'futures';
      
      let nextData;
      if (dataToUpdate.length === 0) {
        if (isBinanceFutures) {
          logChartTelemetry('handleKlineUpdate.skipWsSeedUntilHistory', {
            exchange,
            exchangeType,
            symbol,
            interval,
            seriesKey,
            reason: 'prevent_one_candle_lock',
          });
          return state;
        }
        console.log('[MarketStore] 📊 First candle, initializing chartData');
        nextData = [newCandle];
      } else {
        const existingIndex = dataToUpdate.findIndex(c => c.time === newCandle.time);
        if (existingIndex >= 0) {
          const updated = [...dataToUpdate];
          updated[existingIndex] = newCandle;
          nextData = updated;
        } else {
          nextData = [...dataToUpdate, newCandle];
        }
      }
      
      const isActiveSymbol = state.selectedToken?.fullSymbol === symbol;
      logChartTelemetry('handleKlineUpdate.merge', {
        exchange,
        exchangeType,
        symbol,
        interval,
        seriesKey,
        previousCount: dataToUpdate.length,
        nextCount: nextData.length,
        seededFromEmpty: dataToUpdate.length === 0,
        updateTime: Number(newCandle?.time) || null,
      });

      return {
        ...(isActiveSymbol && { chartData: nextData }),
        chartDataMap: { ...state.chartDataMap, [seriesKey]: nextData }
      };
    });
  },

  // Set realtime connection status
  setRealtimeConnected: (connected) => {
    set({ isRealtimeConnected: connected });
  },

  // Watchlist management
  createWatchlist: (name) => {
    const newWatchlist = {
      id: `watchlist_${Date.now()}`,
      name,
      tokens: []
    };
    const updatedWatchlists = [...get().watchlists, newWatchlist];
    localStorage.setItem('watchlists', JSON.stringify(updatedWatchlists));
    set({ watchlists: updatedWatchlists });
    return newWatchlist.id;
  },

  selectWatchlist: (watchlistId) => {
    set({ selectedWatchlist: watchlistId });
  },

  addTokenToWatchlist: (watchlistId, token) => {
    const watchlists = get().watchlists;
    const updatedWatchlists = watchlists.map(w => {
      if (w.id === watchlistId) {
        // Check if token already exists
        if (w.tokens.find(t => t.fullSymbol === token.fullSymbol)) {
          return w;
        }
        return { ...w, tokens: [...w.tokens, token] };
      }
      return w;
    });
    localStorage.setItem('watchlists', JSON.stringify(updatedWatchlists));
    set({ watchlists: updatedWatchlists });
  },

  removeTokenFromWatchlist: (watchlistId, tokenSymbol) => {
    const watchlists = get().watchlists;
    const updatedWatchlists = watchlists.map(w => {
      if (w.id === watchlistId) {
        return { ...w, tokens: w.tokens.filter(t => t.fullSymbol !== tokenSymbol) };
      }
      return w;
    });
    localStorage.setItem('watchlists', JSON.stringify(updatedWatchlists));
    set({ watchlists: updatedWatchlists });
  },

  deleteWatchlist: (watchlistId) => {
    const watchlists = get().watchlists;
    const updatedWatchlists = watchlists.filter(w => w.id !== watchlistId);
    localStorage.setItem('watchlists', JSON.stringify(updatedWatchlists));
    set({ 
      watchlists: updatedWatchlists,
      selectedWatchlist: get().selectedWatchlist === watchlistId ? null : get().selectedWatchlist
    });
  },

  setExchangeOrWatchlist: (value) => {
    // Clear watchlist selection if an exchange is selected
    if (!value.startsWith('watchlist_')) {
      set({ selectedWatchlist: null });
    }
  }
}));
