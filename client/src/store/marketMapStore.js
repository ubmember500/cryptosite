import { create } from 'zustand';
import api from '../services/api';
import { API_BASE_URL } from '../utils/constants';

const ALLOWED_COUNTS = [3, 6, 8, 9, 12, 16];
const DEFAULT_COUNT = 8;
const SUPPORTED_MARKET_MAP_EXCHANGES = ['binance', 'bybit'];
const DEFAULT_MARKET_MAP_EXCHANGE = 'binance';
const DEFAULT_EXCHANGE_TYPE = 'futures';
const DEFAULT_INTERVAL = '5m';
const DEFAULT_VISIBLE_KLINE_LIMIT = 200;  // initial load — enough to fill a card
const FAST_KLINE_LIMIT = 100;             // direct-exchange fetch limit (smaller = faster response)
const MIN_VISIBLE_KLINE_POINTS = 3;
const VISIBLE_FETCH_CONCURRENCY = 16;     // used only for loadOlderVisibleHistory
const PREFETCH_VISIBLE_MULTIPLIER = 1;    // no background over-fetch on initial load
const CARD_CHANGE_HIGHLIGHT_MS = 12000;
const VALID_SYMBOL_REGEX = /^[A-Z0-9]+$/;
const DEFAULT_RANK_REFRESH_MS = 5000;
const DEFAULT_CHART_REFRESH_MS = 6000;
const RANKING_STALE_AFTER_MS = 60000;
const BINANCE_FUTURES_BASE_URLS = [
  'https://fapi.binance.com/fapi/v1',
  'https://www.binance.com/fapi/v1',
];
const MARKET_MAP_CACHE_KEY = 'market-map-snapshot-v1';
const MARKET_MAP_CACHE_MAX_AGE_MS = 15 * 60 * 1000; // cache valid for 15 min — WS keeps data fresh

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const loadMarketMapSnapshot = () => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(MARKET_MAP_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const ts = Number(parsed?.ts || 0);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > MARKET_MAP_CACHE_MAX_AGE_MS) return null;

    return parsed;
  } catch {
    return null;
  }
};

const saveMarketMapSnapshot = (snapshot) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(MARKET_MAP_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota / private mode errors
  }
};

const mapWithConcurrency = async (items, worker, concurrency) => {
  if (!Array.isArray(items) || items.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.floor(concurrency) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  const runner = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (error) {
        results[currentIndex] = null;
      }
    }
  };

  const workers = Array.from({ length: Math.min(safeConcurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
};

const areKlinesEquivalent = (prevKlines, nextKlines) => {
  if (!Array.isArray(prevKlines) || !Array.isArray(nextKlines)) return false;
  if (prevKlines.length !== nextKlines.length) return false;
  if (prevKlines.length === 0) return true;

  const prevFirst = prevKlines[0];
  const prevLast = prevKlines[prevKlines.length - 1];
  const nextFirst = nextKlines[0];
  const nextLast = nextKlines[nextKlines.length - 1];

  return (
    Number(prevFirst?.time) === Number(nextFirst?.time) &&
    Number(prevLast?.time) === Number(nextLast?.time) &&
    Number(prevLast?.close) === Number(nextLast?.close)
  );
};

const mergeCandlesByTime = (olderCandles, currentCandles) => {
  const mergedMap = new Map();
  [...(olderCandles || []), ...(currentCandles || [])].forEach((candle) => {
    if (!candle || !Number.isFinite(Number(candle.time))) return;
    mergedMap.set(Number(candle.time), candle);
  });
  return Array.from(mergedMap.values()).sort((left, right) => Number(left.time) - Number(right.time));
};

const transformRawBinanceKlines = (rawKlines) => {
  if (!Array.isArray(rawKlines)) return [];
  return rawKlines
    .map((kline) => {
      if (!Array.isArray(kline) || kline.length < 6) return null;
      const openTimeMs = Number(kline[0]);
      const time = Math.floor(openTimeMs / 1000);
      const open = Number(kline[1]);
      const high = Number(kline[2]);
      const low = Number(kline[3]);
      const close = Number(kline[4]);
      const volume = Number(kline[5]);
      if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        return null;
      }
      return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
    })
    .filter(Boolean);
};

const getBinanceProxyUrls = () => {
  const urls = [];
  if (typeof window !== 'undefined' && window.location?.origin) {
    urls.push(`${window.location.origin}/api/binance-klines`);
  }
  urls.push(`${API_BASE_URL.replace(/\/$/, '')}/binance-klines`);
  return Array.from(new Set(urls));
};

const fetchBinanceFuturesKlinesDirect = async (symbol, interval = '5m', limit = DEFAULT_VISIBLE_KLINE_LIMIT, before = null) => {
  const query = new URLSearchParams({
    symbol: String(symbol || '').toUpperCase(),
    interval,
    limit: String(limit),
    ...(before ? { endTime: String(Math.floor(Number(before)) - 1) } : {}),
  });

  let lastError = null;

  // 1. Try direct Binance first (fastest, no intermediary)
  for (const baseUrl of BINANCE_FUTURES_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}/klines?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Direct HTTP ${response.status}`);
      }
      const raw = await response.json();
      const transformed = transformRawBinanceKlines(raw);
      if (transformed.length > 0) return transformed;
    } catch (error) {
      lastError = error;
    }
  }

  // 2. Fallback to proxy (Vercel edge) if direct is blocked
  for (const proxyUrl of getBinanceProxyUrls()) {
    try {
      const response = await fetch(`${proxyUrl}?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Proxy HTTP ${response.status}`);
      }
      const data = await response.json();
      const raw = Array.isArray(data?.klines) ? data.klines : (Array.isArray(data) ? data : []);
      const transformed = transformRawBinanceKlines(raw);
      if (transformed.length > 0) return transformed;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to fetch Binance futures klines directly');
};

const BYBIT_FUTURES_BASE_URL = 'https://api.bybit.com';
// Bybit interval mapping (5m → '5', 1h → '60', etc.)
const BYBIT_INTERVAL_MAP = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };

const fetchBybitFuturesKlinesDirect = async (symbol, interval = '5m', limit = DEFAULT_VISIBLE_KLINE_LIMIT, before = null) => {
  const bybitInterval = BYBIT_INTERVAL_MAP[interval] || '5';
  const hasBefore = before !== null && Number.isFinite(Number(before)) && Number(before) > 0;

  const params = new URLSearchParams({
    category: 'linear',
    symbol: String(symbol || '').toUpperCase(),
    interval: bybitInterval,
    limit: String(limit),
    ...(hasBefore ? { end: String(Math.floor(Number(before)) - 1) } : {}),
  });

  const response = await fetch(`${BYBIT_FUTURES_BASE_URL}/v5/market/kline?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Bybit direct klines HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data?.retCode !== 0) {
    throw new Error(data?.retMsg || 'Bybit API error');
  }

  const rawList = data?.result?.list || [];
  // Bybit returns newest-first; reverse to chronological order
  const klines = rawList
    .map((arr) => {
      const startTimeMs = parseInt(arr[0], 10);
      const time = Math.floor(startTimeMs / 1000);
      const open = parseFloat(arr[1]);
      const high = parseFloat(arr[2]);
      const low = parseFloat(arr[3]);
      const close = parseFloat(arr[4]);
      const volume = parseFloat(arr[5]) || 0;
      if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        return null;
      }
      return { time, open, high, low, close, volume };
    })
    .filter(Boolean)
    .reverse();

  return klines;
};

export const useMarketMapStore = create((set, get) => ({
  selectedExchange: DEFAULT_MARKET_MAP_EXCHANGE,
  cadence: {
    rankRefreshMs: DEFAULT_RANK_REFRESH_MS,
    chartRefreshMs: DEFAULT_CHART_REFRESH_MS,
  },
  activityScoreContract: {
    type: '5m-absolute-change-percent',
    interval: '5m',
    lookbackCandles: null,
  },
  selectedCount: DEFAULT_COUNT,
  rankedSymbols: [],
  visibleSymbols: [],
  klinesBySymbol: {},
  chartHistoryBySymbol: {},
  cardLoadingBySymbol: {},
  cardErrorBySymbol: {},
  historyReadyBySymbol: {},
  queuedRealtimeBySymbol: {},
  dataUpdatedAtBySymbol: {},
  changedAtBySymbol: {},
  slotChangedAtByIndex: {},
  loading: false,
  isRefreshing: false,
  isRankingRefresh: false,
  isHydratingVisible: false,
  isRealtimeConnected: false,
  activeRealtimeSymbols: [],
  rankingIsStale: false,
  rankingWarmupRatio: 0,
  rankingScoredCount: 0,
  error: null,
  lastUpdated: null,
  lastUniverseSuccessAt: null,

  universeSymbols: [],

  setCadence: ({ rankRefreshMs, chartRefreshMs } = {}) => {
    set((state) => ({
      cadence: {
        rankRefreshMs:
          Number.isFinite(Number(rankRefreshMs)) && Number(rankRefreshMs) > 0
            ? Number(rankRefreshMs)
            : state.cadence.rankRefreshMs,
        chartRefreshMs:
          Number.isFinite(Number(chartRefreshMs)) && Number(chartRefreshMs) > 0
            ? Number(chartRefreshMs)
            : state.cadence.chartRefreshMs,
      },
    }));
  },

  hydrateFromCache: () => {
    const snapshot = loadMarketMapSnapshot();
    if (!snapshot) return false;

    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(snapshot.exchange)
      ? snapshot.exchange
      : null;

    if (!selectedExchange || selectedExchange !== get().selectedExchange) {
      return false;
    }

    const rankedSymbols = Array.isArray(snapshot.rankedSymbols) ? snapshot.rankedSymbols : [];
    const visibleSymbols = Array.isArray(snapshot.visibleSymbols) ? snapshot.visibleSymbols : [];
    const klinesBySymbol = snapshot.klinesBySymbol && typeof snapshot.klinesBySymbol === 'object'
      ? snapshot.klinesBySymbol
      : {};
    const chartHistoryBySymbol = snapshot.chartHistoryBySymbol && typeof snapshot.chartHistoryBySymbol === 'object'
      ? snapshot.chartHistoryBySymbol
      : {};

    if (rankedSymbols.length === 0 || visibleSymbols.length === 0) {
      return false;
    }

    const now = Date.now();
    const historyReadyBySymbol = {};
    const cardLoadingBySymbol = {};
    const cardErrorBySymbol = {};
    const dataUpdatedAtBySymbol = {};

    visibleSymbols.forEach((row) => {
      const symbol = row?.symbol;
      if (!symbol) return;
      const points = Array.isArray(klinesBySymbol[symbol]) ? klinesBySymbol[symbol].length : 0;
      const ready = points >= MIN_VISIBLE_KLINE_POINTS;
      historyReadyBySymbol[symbol] = ready;
      cardLoadingBySymbol[symbol] = !ready;
      cardErrorBySymbol[symbol] = null;
      dataUpdatedAtBySymbol[symbol] = now;
    });

    set((state) => ({
      rankedSymbols,
      universeSymbols: rankedSymbols,
      visibleSymbols,
      klinesBySymbol: {
        ...state.klinesBySymbol,
        ...klinesBySymbol,
      },
      chartHistoryBySymbol: {
        ...state.chartHistoryBySymbol,
        ...chartHistoryBySymbol,
      },
      historyReadyBySymbol: {
        ...state.historyReadyBySymbol,
        ...historyReadyBySymbol,
      },
      cardLoadingBySymbol: {
        ...state.cardLoadingBySymbol,
        ...cardLoadingBySymbol,
      },
      cardErrorBySymbol: {
        ...state.cardErrorBySymbol,
        ...cardErrorBySymbol,
      },
      dataUpdatedAtBySymbol: {
        ...state.dataUpdatedAtBySymbol,
        ...dataUpdatedAtBySymbol,
      },
      rankingScoredCount: rankedSymbols.filter((row) => row.activityMetric === 'change5m').length,
      rankingWarmupRatio: rankedSymbols.length > 0
        ? rankedSymbols.filter((row) => row.activityMetric === 'change5m').length / rankedSymbols.length
        : 0,
      lastUpdated: new Date(snapshot.ts).toISOString(),
      loading: false,
      error: null,
    }));

    return true;
  },

  persistSnapshot: () => {
    const state = get();
    const visibleSymbols = Array.isArray(state.visibleSymbols) ? state.visibleSymbols : [];
    const rankedSymbols = Array.isArray(state.rankedSymbols) ? state.rankedSymbols : [];

    if (visibleSymbols.length === 0 || rankedSymbols.length === 0) return;

    const klinesBySymbol = {};
    const chartHistoryBySymbol = {};

    visibleSymbols.forEach((row) => {
      const symbol = row?.symbol;
      if (!symbol) return;

      const klines = Array.isArray(state.klinesBySymbol[symbol]) ? state.klinesBySymbol[symbol] : [];
      if (klines.length > 0) {
        klinesBySymbol[symbol] = klines;
      }

      if (state.chartHistoryBySymbol[symbol]) {
        chartHistoryBySymbol[symbol] = state.chartHistoryBySymbol[symbol];
      }
    });

    saveMarketMapSnapshot({
      ts: Date.now(),
      exchange: state.selectedExchange,
      rankedSymbols,
      visibleSymbols,
      klinesBySymbol,
      chartHistoryBySymbol,
    });
  },

  initialize: async () => {
    const hydrated = get().hydrateFromCache();
    await get().refreshData({ silent: hydrated ? true : false, force: true });
  },

  refreshData: async ({ silent = true, force = false } = {}) => {
    if (get().isRefreshing && !force) return;

    set((state) => ({
      ...(silent ? {} : { loading: true }),
      isRefreshing: true,
      error: state.error,
    }));

    try {
      await get().refreshRanking({ silent, force });
      await get().refreshVisibleCharts({ force });

      set({
        ...(silent ? {} : { loading: false }),
        isRefreshing: false,
        error: null,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      set({
        ...(silent ? {} : { loading: false }),
        isRefreshing: false,
        error: error?.message || 'Failed to refresh market map',
      });
    }
  },

  refreshRanking: async ({ silent = true, force = false } = {}) => {
    if (get().isRankingRefresh && !force) return;

    set((state) => ({
      ...(silent ? {} : { loading: true }),
      isRankingRefresh: true,
      error: state.error,
    }));

    try {
      await get().refreshUniverse();
      await get().computeActivityRank();
      get().syncVisibleCharts();

      set({
        ...(silent ? {} : { loading: false }),
        isRankingRefresh: false,
        error: null,
        rankingIsStale: false,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      set({
        ...(silent ? {} : { loading: false }),
        isRankingRefresh: false,
        rankingIsStale: true,
        error: error?.message || 'Failed to refresh ranking',
      });
    }
  },

  refreshVisibleCharts: async ({ force = false } = {}) => {
    if (get().isHydratingVisible && !force) return;

    set({ isHydratingVisible: true });
    try {
      await get().hydrateVisibleKlines();
    } finally {
      set({ isHydratingVisible: false });
    }
  },

  syncRealtimeSubscriptions: (socket) => {
    if (!socket) return;

    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(get().selectedExchange)
      ? get().selectedExchange
      : DEFAULT_MARKET_MAP_EXCHANGE;

    const visibleSymbols = Array.isArray(get().visibleSymbols)
      ? get().visibleSymbols.map((row) => row?.symbol).filter(Boolean)
      : [];

    const desired = new Set(visibleSymbols);
    const current = new Set(get().activeRealtimeSymbols || []);

    current.forEach((symbol) => {
      if (!desired.has(symbol)) {
        socket.unsubscribeKline(selectedExchange, symbol, DEFAULT_INTERVAL, DEFAULT_EXCHANGE_TYPE);
      }
    });

    desired.forEach((symbol) => {
      if (!current.has(symbol)) {
        socket.subscribeKline(selectedExchange, symbol, DEFAULT_INTERVAL, DEFAULT_EXCHANGE_TYPE);
      }
    });

    set({ activeRealtimeSymbols: Array.from(desired) });
  },

  clearRealtimeSubscriptions: (socket) => {
    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(get().selectedExchange)
      ? get().selectedExchange
      : DEFAULT_MARKET_MAP_EXCHANGE;
    const current = get().activeRealtimeSymbols || [];
    if (socket) {
      current.forEach((symbol) => {
        socket.unsubscribeKline(selectedExchange, symbol, DEFAULT_INTERVAL, DEFAULT_EXCHANGE_TYPE);
      });
    }
    set({ activeRealtimeSymbols: [] });
  },

  handleRealtimeKlineUpdate: (updateData) => {
    const { exchange, exchangeType, interval, symbol, kline } = updateData || {};
    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(get().selectedExchange)
      ? get().selectedExchange
      : DEFAULT_MARKET_MAP_EXCHANGE;

    if (
      exchange !== selectedExchange ||
      exchangeType !== DEFAULT_EXCHANGE_TYPE ||
      interval !== DEFAULT_INTERVAL ||
      !symbol ||
      !kline
    ) {
      return;
    }

    set((state) => {
      const currentData = Array.isArray(state.klinesBySymbol[symbol])
        ? state.klinesBySymbol[symbol]
        : [];

      const isHistoryReady = Boolean(state.historyReadyBySymbol[symbol]);
      if (!isHistoryReady) {
        return {
          queuedRealtimeBySymbol: {
            ...state.queuedRealtimeBySymbol,
            [symbol]: kline,
          },
        };
      }

      const existingIndex = currentData.findIndex((candle) => Number(candle?.time) === Number(kline.time));
      let nextData;

      if (existingIndex >= 0) {
        nextData = [...currentData];
        nextData[existingIndex] = kline;
      } else {
        nextData = [...currentData, kline];
      }

      return {
        klinesBySymbol: {
          ...state.klinesBySymbol,
          [symbol]: nextData,
        },
        cardLoadingBySymbol: {
          ...state.cardLoadingBySymbol,
          [symbol]: false,
        },
        cardErrorBySymbol: {
          ...state.cardErrorBySymbol,
          [symbol]: null,
        },
        queuedRealtimeBySymbol: {
          ...state.queuedRealtimeBySymbol,
          [symbol]: null,
        },
        dataUpdatedAtBySymbol: {
          ...state.dataUpdatedAtBySymbol,
          [symbol]: Date.now(),
        },
      };
    });
  },

  setRealtimeConnected: (connected) => {
    set({ isRealtimeConnected: Boolean(connected) });
  },

  setChartCount: (count) => {
    const parsedCount = Number(count);
    if (!ALLOWED_COUNTS.includes(parsedCount)) return;

    set({ selectedCount: parsedCount });
    get().syncVisibleCharts();
    get().hydrateVisibleKlines();
  },

  setSelectedExchange: async (exchange) => {
    const normalizedExchange = String(exchange || '').toLowerCase();
    if (!SUPPORTED_MARKET_MAP_EXCHANGES.includes(normalizedExchange)) return;

    if (get().selectedExchange === normalizedExchange) return;

    set({
      selectedExchange: normalizedExchange,
      isRefreshing: false,
      isRankingRefresh: false,
      isHydratingVisible: false,
      rankedSymbols: [],
      visibleSymbols: [],
      klinesBySymbol: {},
      chartHistoryBySymbol: {},
      cardLoadingBySymbol: {},
      cardErrorBySymbol: {},
      historyReadyBySymbol: {},
      queuedRealtimeBySymbol: {},
      dataUpdatedAtBySymbol: {},
      changedAtBySymbol: {},
      slotChangedAtByIndex: {},
      rankingIsStale: false,
      rankingWarmupRatio: 0,
      rankingScoredCount: 0,
      error: null,
    });

    await get().refreshData({ silent: false, force: true });
  },

  refreshUniverse: async () => {
    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(get().selectedExchange)
      ? get().selectedExchange
      : DEFAULT_MARKET_MAP_EXCHANGE;

    const response = await api.get(`/market/${selectedExchange}/market-map`, {
      params: {
        limit: 0,
      },
    });

    const rows = Array.isArray(response?.data?.rows) ? response.data.rows : [];
    const warmupRatio = toFiniteNumber(response?.data?.warmupRatio) ?? 0;
    const scoredCount = Number(response?.data?.scoredCount || 0);
    const isStale = Boolean(response?.data?.isStale);
    const updatedAt = response?.data?.updatedAt || null;
    const contractType = response?.data?.contract?.type || null;

    const normalized = rows
      .map((token) => ({
        symbol: token?.symbol,
        volume24h: toFiniteNumber(token?.volume24h) ?? 0,
        activityScore: toFiniteNumber(token?.activityScore) ?? 0,
        // natr24h_warmup  → warmup badge shown
        // natr5m_kline    → fully scored (kline-based, no warmup badge)
        // natr5m          → fully scored (live ring-buffer)
        activityMetric: token?.activityMetric === 'natr24h_warmup' ? 'change5m_warmup' : 'change5m',
      }))
      .filter(
        (token) =>
          typeof token.symbol === 'string' &&
          token.symbol.length > 0 &&
          VALID_SYMBOL_REGEX.test(token.symbol)
      );

    set({
      universeSymbols: normalized,
      rankedSymbols: normalized,
      rankingScoredCount: scoredCount,
      rankingWarmupRatio: warmupRatio,
      rankingIsStale: isStale,
      lastUniverseSuccessAt: updatedAt ? Date.parse(updatedAt) : Date.now(),
      activityScoreContract: {
        type: contractType || '5m-absolute-change-percent',
        interval: '5m',
        lookbackCandles: null,
      },
    });

    return normalized;
  },

  computeActivityRank: async () => {
    const universe = get().universeSymbols;

    if (!Array.isArray(universe) || universe.length === 0) {
      set({
        rankedSymbols: [],
        visibleSymbols: [],
        klinesBySymbol: {},
        chartHistoryBySymbol: {},
        cardLoadingBySymbol: {},
        cardErrorBySymbol: {},
        historyReadyBySymbol: {},
        queuedRealtimeBySymbol: {},
        dataUpdatedAtBySymbol: {},
        changedAtBySymbol: {},
        slotChangedAtByIndex: {},
      });
      return [];
    }

    const ranked = universe
      .filter((item) => typeof item?.symbol === 'string' && item.symbol.length > 0)
      .sort((a, b) => {
        if (b.activityScore !== a.activityScore) {
          return b.activityScore - a.activityScore;
        }

        if (b.volume24h !== a.volume24h) {
          return b.volume24h - a.volume24h;
        }

        return a.symbol.localeCompare(b.symbol);
      });

    const nowTs = Date.now();
    const lastUniverseSuccessAt = Number(get().lastUniverseSuccessAt || 0);
    const rankingIsStale = !lastUniverseSuccessAt || nowTs - lastUniverseSuccessAt > RANKING_STALE_AFTER_MS;
    const scoredCount = ranked.filter((row) => row.activityMetric === 'change5m').length;
    const warmupRatio = ranked.length > 0 ? scoredCount / ranked.length : 0;

    set({ rankedSymbols: ranked, rankingScoredCount: scoredCount, rankingWarmupRatio: warmupRatio, rankingIsStale });

    return ranked;
  },

  syncVisibleCharts: () => {
    const { selectedCount, rankedSymbols, visibleSymbols: previousVisible, changedAtBySymbol } = get();

    if (!Array.isArray(rankedSymbols) || rankedSymbols.length === 0) {
      set({
        visibleSymbols: [],
        historyReadyBySymbol: {},
        queuedRealtimeBySymbol: {},
        lastUpdated: new Date().toISOString(),
      });
      return [];
    }

    const rows = rankedSymbols.slice(0, selectedCount);

    const now = Date.now();
    const previousSlots = Array.isArray(previousVisible)
      ? previousVisible.map((row) => row.symbol)
      : [];

    const nextChanged = Object.fromEntries(
      Object.entries(changedAtBySymbol || {}).filter(([, timestamp]) => {
        const age = now - Number(timestamp || 0);
        return Number.isFinite(age) && age < CARD_CHANGE_HIGHLIGHT_MS;
      })
    );

    const nextSlotChanged = {};

    rows.forEach((row, index) => {
      const prevSymbolAtSlot = previousSlots[index] || null;
      if (row?.symbol && prevSymbolAtSlot !== row.symbol) {
        nextChanged[row.symbol] = now;
        nextSlotChanged[index] = now;
      } else if (prevSymbolAtSlot && row?.symbol === prevSymbolAtSlot) {
        nextSlotChanged[index] = now;
      }
    });

    const visibleSet = new Set(rows.map((row) => row.symbol));

    set((state) => {
      const nextHistoryReadyBySymbol = {};
      Object.entries(state.historyReadyBySymbol || {}).forEach(([symbol, isReady]) => {
        if (visibleSet.has(symbol)) {
          nextHistoryReadyBySymbol[symbol] = Boolean(isReady);
        }
      });

      const nextQueuedRealtimeBySymbol = {};
      Object.entries(state.queuedRealtimeBySymbol || {}).forEach(([symbol, queued]) => {
        if (visibleSet.has(symbol) && queued) {
          nextQueuedRealtimeBySymbol[symbol] = queued;
        }
      });

      rows.forEach((row) => {
        if (!(row.symbol in nextHistoryReadyBySymbol)) {
          nextHistoryReadyBySymbol[row.symbol] = false;
        }
      });

      return {
        visibleSymbols: rows,
        changedAtBySymbol: nextChanged,
        slotChangedAtByIndex: nextSlotChanged,
        historyReadyBySymbol: nextHistoryReadyBySymbol,
        queuedRealtimeBySymbol: nextQueuedRealtimeBySymbol,
        lastUpdated: new Date().toISOString(),
      };
    });

    return rows;
  },

  hydrateVisibleKlines: async () => {
    const visible = get().visibleSymbols;
    if (!Array.isArray(visible) || visible.length === 0) return;

    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(get().selectedExchange)
      ? get().selectedExchange
      : DEFAULT_MARKET_MAP_EXCHANGE;
    const isBinance = selectedExchange === 'binance';
    const isBybit = selectedExchange === 'bybit';

    // ── Step 1: mark visible cards as loading unless already cached ─────────
    set((state) => {
      const nextLoading = { ...state.cardLoadingBySymbol };
      const nextErrors = { ...state.cardErrorBySymbol };
      const nextHistoryReady = { ...state.historyReadyBySymbol };

      visible.forEach((row) => {
        const cached = Array.isArray(state.klinesBySymbol[row.symbol])
          ? state.klinesBySymbol[row.symbol]
          : [];
        const hasUsableCache = cached.length >= MIN_VISIBLE_KLINE_POINTS;
        nextLoading[row.symbol] = !hasUsableCache;
        nextErrors[row.symbol] = null;
        nextHistoryReady[row.symbol] = hasUsableCache;
      });

      return {
        cardLoadingBySymbol: nextLoading,
        cardErrorBySymbol: nextErrors,
        historyReadyBySymbol: nextHistoryReady,
      };
    });

    // ── Step 2: direct-exchange fetch — bypasses backend for speed ──────────
    //   • Binance → Vercel edge function /api/binance-klines (no server roundtrip)
    //   • Bybit   → api.bybit.com directly
    //   All visible cards fetched in parallel with Promise.all
    const fetchDirect = async (symbol) => {
      if (isBinance) {
        return fetchBinanceFuturesKlinesDirect(symbol, DEFAULT_INTERVAL, FAST_KLINE_LIMIT);
      }
      if (isBybit) {
        return fetchBybitFuturesKlinesDirect(symbol, DEFAULT_INTERVAL, FAST_KLINE_LIMIT);
      }
      // Fallback for any future exchange: backend API
      const response = await api.get(`/market/${selectedExchange}/klines`, {
        params: {
          symbol,
          exchangeType: DEFAULT_EXCHANGE_TYPE,
          interval: DEFAULT_INTERVAL,
          limit: FAST_KLINE_LIMIT,
        },
      });
      return Array.isArray(response?.data?.klines) ? response.data.klines : [];
    };

    await Promise.all(
      visible.filter((row) => {
        const cached = get().klinesBySymbol[row.symbol];
        return !Array.isArray(cached) || cached.length < MIN_VISIBLE_KLINE_POINTS;
      }).map(async (row) => {
        const { symbol } = row;
        try {
          const klines = await fetchDirect(symbol);

          if (!Array.isArray(klines) || klines.length < MIN_VISIBLE_KLINE_POINTS) {
            throw new Error(`Insufficient chart data returned for ${symbol}`);
          }

          set((state) => {
            const queuedRealtime = state.queuedRealtimeBySymbol[symbol];
            const mergedWithQueued = queuedRealtime
              ? mergeCandlesByTime(klines, [queuedRealtime])
              : klines;

            const prevKlines = state.klinesBySymbol[symbol] || [];
            const nextKlines = areKlinesEquivalent(prevKlines, mergedWithQueued)
              ? prevKlines
              : mergedWithQueued;
            const earliestTime = nextKlines.length > 0 ? Number(nextKlines[0].time) : null;

            return {
              klinesBySymbol: {
                ...state.klinesBySymbol,
                [symbol]: nextKlines,
              },
              chartHistoryBySymbol: {
                ...state.chartHistoryBySymbol,
                [symbol]: {
                  earliestTime,
                  hasMoreHistory: nextKlines.length > 0,
                  loadingOlder: false,
                },
              },
              cardLoadingBySymbol: {
                ...state.cardLoadingBySymbol,
                [symbol]: false,
              },
              cardErrorBySymbol: {
                ...state.cardErrorBySymbol,
                [symbol]: null,
              },
              historyReadyBySymbol: {
                ...state.historyReadyBySymbol,
                [symbol]: true,
              },
              queuedRealtimeBySymbol: {
                ...state.queuedRealtimeBySymbol,
                [symbol]: null,
              },
              dataUpdatedAtBySymbol: {
                ...state.dataUpdatedAtBySymbol,
                [symbol]: Date.now(),
              },
            };
          });
        } catch (error) {
          const fallbackCached = get().klinesBySymbol[symbol] || [];
          if (Array.isArray(fallbackCached) && fallbackCached.length >= MIN_VISIBLE_KLINE_POINTS) {
            // Already have cached data — just clear the loading spinner
            set((state) => ({
              cardLoadingBySymbol: { ...state.cardLoadingBySymbol, [symbol]: false },
              cardErrorBySymbol:   { ...state.cardErrorBySymbol,   [symbol]: null },
              historyReadyBySymbol:{ ...state.historyReadyBySymbol,[symbol]: true },
            }));
          } else {
            set((state) => ({
              cardLoadingBySymbol:  { ...state.cardLoadingBySymbol,  [symbol]: false },
              cardErrorBySymbol:    { ...state.cardErrorBySymbol,    [symbol]: error?.message || `Failed to load ${symbol}` },
              historyReadyBySymbol: { ...state.historyReadyBySymbol, [symbol]: false },
              chartHistoryBySymbol: {
                ...state.chartHistoryBySymbol,
                [symbol]: { ...(state.chartHistoryBySymbol[symbol] || {}), loadingOlder: false },
              },
            }));
          }
        }
      })
    );

    get().persistSnapshot();
  },

  loadOlderVisibleHistory: async (symbol, beforeTimestampMs) => {
    const safeSymbol = String(symbol || '').toUpperCase();
    if (!safeSymbol) return [];

    const beforeTimestamp = Number(beforeTimestampMs);
    if (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0) return [];

    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(get().selectedExchange)
      ? get().selectedExchange
      : DEFAULT_MARKET_MAP_EXCHANGE;

    const historyMeta = get().chartHistoryBySymbol[safeSymbol] || {
      earliestTime: null,
      hasMoreHistory: true,
      loadingOlder: false,
    };

    if (historyMeta.loadingOlder || historyMeta.hasMoreHistory === false) {
      return [];
    }

    set((state) => ({
      chartHistoryBySymbol: {
        ...state.chartHistoryBySymbol,
        [safeSymbol]: {
          ...(state.chartHistoryBySymbol[safeSymbol] || historyMeta),
          loadingOlder: true,
        },
      },
    }));

    try {
      const beforeSeconds = Math.floor(beforeTimestamp / 1000);

      let fetched = [];
      try {
        const response = await api.get(`/market/${selectedExchange}/klines`, {
          params: {
            symbol: safeSymbol,
            exchangeType: DEFAULT_EXCHANGE_TYPE,
            interval: DEFAULT_INTERVAL,
            limit: DEFAULT_VISIBLE_KLINE_LIMIT,
            before: String(Math.floor(beforeTimestamp)),
          },
        });
        fetched = Array.isArray(response?.data?.klines) ? response.data.klines : [];
      } catch {
        fetched = [];
      }

      let older = fetched.filter((kline) => Number(kline.time) < beforeSeconds);

      if (selectedExchange === 'binance' && older.length === 0) {
        try {
          const directFetched = await fetchBinanceFuturesKlinesDirect(
            safeSymbol,
            DEFAULT_INTERVAL,
            DEFAULT_VISIBLE_KLINE_LIMIT,
            beforeTimestamp
          );
          const directOlder = directFetched.filter((kline) => Number(kline.time) < beforeSeconds);
          if (directOlder.length > older.length) {
            older = directOlder;
          }
        } catch {
          // Keep backend older candles if any
        }
      } else if (selectedExchange === 'bybit' && older.length === 0) {
        try {
          const directFetched = await fetchBybitFuturesKlinesDirect(
            safeSymbol,
            DEFAULT_INTERVAL,
            DEFAULT_VISIBLE_KLINE_LIMIT,
            beforeTimestamp
          );
          const directOlder = directFetched.filter((kline) => Number(kline.time) < beforeSeconds);
          if (directOlder.length > older.length) {
            older = directOlder;
          }
        } catch {
          // Keep backend older candles if any
        }
      }

      set((state) => {
        const current = state.klinesBySymbol[safeSymbol] || [];
        const merged = mergeCandlesByTime(older, current);
        const earliestTime = merged.length > 0 ? Number(merged[0].time) : null;
        return {
          klinesBySymbol: {
            ...state.klinesBySymbol,
            [safeSymbol]: merged,
          },
          chartHistoryBySymbol: {
            ...state.chartHistoryBySymbol,
            [safeSymbol]: {
              earliestTime,
              hasMoreHistory: older.length > 0,
              loadingOlder: false,
            },
          },
        };
      });

      get().persistSnapshot();

      return older;
    } catch {
      set((state) => ({
        chartHistoryBySymbol: {
          ...state.chartHistoryBySymbol,
          [safeSymbol]: {
            ...(state.chartHistoryBySymbol[safeSymbol] || historyMeta),
            loadingOlder: false,
          },
        },
      }));
      return [];
    }
  },
}));
