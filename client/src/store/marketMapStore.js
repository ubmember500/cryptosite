import { create } from 'zustand';
import api from '../services/api';

const ALLOWED_COUNTS = [3, 6, 8, 9, 12, 16];
const DEFAULT_COUNT = 8;
const SUPPORTED_MARKET_MAP_EXCHANGES = ['binance', 'bybit'];
const DEFAULT_MARKET_MAP_EXCHANGE = 'binance';
const DEFAULT_EXCHANGE_TYPE = 'futures';
const DEFAULT_INTERVAL = '5m';
const DEFAULT_VISIBLE_KLINE_LIMIT = 50;
const MIN_VISIBLE_KLINE_POINTS = 20;
const VISIBLE_FETCH_CONCURRENCY = 4;
const CARD_CHANGE_HIGHLIGHT_MS = 12000;
const VALID_SYMBOL_REGEX = /^[A-Z0-9]+$/;
const DEFAULT_RANK_REFRESH_MS = 20000;
const DEFAULT_CHART_REFRESH_MS = 8000;
const RANKING_STALE_AFTER_MS = 60000;

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  cardLoadingBySymbol: {},
  cardErrorBySymbol: {},
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

  initialize: async () => {
    await get().refreshData({ silent: false });
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
      cardLoadingBySymbol: {},
      cardErrorBySymbol: {},
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
        activityMetric: token?.warmup ? 'change5m_warmup' : 'change5m',
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
        cardLoadingBySymbol: {},
        cardErrorBySymbol: {},
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
      set({ visibleSymbols: [], lastUpdated: new Date().toISOString() });
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

    set({
      visibleSymbols: rows,
      changedAtBySymbol: nextChanged,
      slotChangedAtByIndex: nextSlotChanged,
      lastUpdated: new Date().toISOString(),
    });

    return rows;
  },

  hydrateVisibleKlines: async () => {
    const visible = get().visibleSymbols;
    if (!Array.isArray(visible) || visible.length === 0) return;

    const selectedExchange = SUPPORTED_MARKET_MAP_EXCHANGES.includes(get().selectedExchange)
      ? get().selectedExchange
      : DEFAULT_MARKET_MAP_EXCHANGE;

    set((state) => {
      const nextLoading = { ...state.cardLoadingBySymbol };
      const nextErrors = { ...state.cardErrorBySymbol };
      visible.forEach((row) => {
        nextLoading[row.symbol] = true;
        nextErrors[row.symbol] = null;
      });
      return {
        cardLoadingBySymbol: nextLoading,
        cardErrorBySymbol: nextErrors,
      };
    });

    const responses = await mapWithConcurrency(
      visible,
      async (row) => {
        try {
          const response = await api.get(`/market/${selectedExchange}/klines`, {
            params: {
              symbol: row.symbol,
              exchangeType: DEFAULT_EXCHANGE_TYPE,
              interval: DEFAULT_INTERVAL,
              limit: DEFAULT_VISIBLE_KLINE_LIMIT,
            },
          });

          const klines = Array.isArray(response?.data?.klines) ? response.data.klines : [];

          if (klines.length < MIN_VISIBLE_KLINE_POINTS) {
            return {
              symbol: row.symbol,
              klines: null,
              error: `Insufficient chart data returned for ${row.symbol}`,
            };
          }

          return { symbol: row.symbol, klines, error: null };
        } catch (error) {
          return {
            symbol: row.symbol,
            klines: null,
            error: error?.message || `Failed to load ${row.symbol} chart`,
          };
        }
      },
      VISIBLE_FETCH_CONCURRENCY
    );

    set((state) => {
      const nextMap = { ...state.klinesBySymbol };
      const nextLoading = { ...state.cardLoadingBySymbol };
      const nextErrors = { ...state.cardErrorBySymbol };
      const nextUpdatedAt = { ...state.dataUpdatedAtBySymbol };

      responses.forEach((item) => {
        if (Array.isArray(item.klines) && item.klines.length > 0) {
          const prevKlines = state.klinesBySymbol[item.symbol] || [];
          nextMap[item.symbol] = areKlinesEquivalent(prevKlines, item.klines)
            ? prevKlines
            : item.klines;
          nextErrors[item.symbol] = null;
          nextUpdatedAt[item.symbol] = Date.now();
        } else {
          nextErrors[item.symbol] = item.error;
        }
        nextLoading[item.symbol] = false;
      });

      return {
        klinesBySymbol: nextMap,
        cardLoadingBySymbol: nextLoading,
        cardErrorBySymbol: nextErrors,
        dataUpdatedAtBySymbol: nextUpdatedAt,
      };
    });
  },
}));
