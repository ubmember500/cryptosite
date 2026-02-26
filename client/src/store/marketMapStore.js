import { create } from 'zustand';
import api from '../services/api';
import { API_BASE_URL } from '../utils/constants';

const ALLOWED_COUNTS = [3, 6, 8, 9, 12, 16];
const DEFAULT_COUNT = 8;
const SUPPORTED_MARKET_MAP_EXCHANGES = ['binance', 'bybit'];
const DEFAULT_MARKET_MAP_EXCHANGE = 'binance';
const DEFAULT_EXCHANGE_TYPE = 'futures';
const DEFAULT_INTERVAL = '5m';
const DEFAULT_VISIBLE_KLINE_LIMIT = 300;
const MIN_VISIBLE_KLINE_POINTS = 20;
const VISIBLE_FETCH_CONCURRENCY = 6;
const CARD_CHANGE_HIGHLIGHT_MS = 12000;
const VALID_SYMBOL_REGEX = /^[A-Z0-9]+$/;
const DEFAULT_RANK_REFRESH_MS = 5000;
const DEFAULT_CHART_REFRESH_MS = 6000;
const RANKING_STALE_AFTER_MS = 60000;
const BINANCE_FUTURES_BASE_URLS = [
  'https://fapi.binance.com/fapi/v1',
  'https://www.binance.com/fapi/v1',
];

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

  throw lastError || new Error('Failed to fetch Binance futures klines directly');
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
      chartHistoryBySymbol: {},
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
    const isBinance = selectedExchange === 'binance';

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

    await mapWithConcurrency(
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

          let klines = Array.isArray(response?.data?.klines) ? response.data.klines : [];

          if (isBinance && klines.length < MIN_VISIBLE_KLINE_POINTS) {
            try {
              const directKlines = await fetchBinanceFuturesKlinesDirect(
                row.symbol,
                DEFAULT_INTERVAL,
                DEFAULT_VISIBLE_KLINE_LIMIT
              );
              if (Array.isArray(directKlines) && directKlines.length > klines.length) {
                klines = directKlines;
              }
            } catch {
              // Keep backend result/error path
            }
          }

          if (klines.length < MIN_VISIBLE_KLINE_POINTS) {
            throw new Error(`Insufficient chart data returned for ${row.symbol}`);
          }

          set((state) => {
            const prevKlines = state.klinesBySymbol[row.symbol] || [];
            const nextKlines = areKlinesEquivalent(prevKlines, klines) ? prevKlines : klines;
            const earliestTime = nextKlines.length > 0 ? Number(nextKlines[0].time) : null;

            return {
              klinesBySymbol: {
                ...state.klinesBySymbol,
                [row.symbol]: nextKlines,
              },
              chartHistoryBySymbol: {
                ...state.chartHistoryBySymbol,
                [row.symbol]: {
                  earliestTime,
                  hasMoreHistory: nextKlines.length > 0,
                  loadingOlder: false,
                },
              },
              cardLoadingBySymbol: {
                ...state.cardLoadingBySymbol,
                [row.symbol]: false,
              },
              cardErrorBySymbol: {
                ...state.cardErrorBySymbol,
                [row.symbol]: null,
              },
              dataUpdatedAtBySymbol: {
                ...state.dataUpdatedAtBySymbol,
                [row.symbol]: Date.now(),
              },
            };
          });
        } catch (error) {
          set((state) => ({
            cardLoadingBySymbol: {
              ...state.cardLoadingBySymbol,
              [row.symbol]: false,
            },
            cardErrorBySymbol: {
              ...state.cardErrorBySymbol,
              [row.symbol]: error?.message || `Failed to load ${row.symbol} chart`,
            },
            chartHistoryBySymbol: {
              ...state.chartHistoryBySymbol,
              [row.symbol]: {
                ...(state.chartHistoryBySymbol[row.symbol] || {}),
                loadingOlder: false,
              },
            },
          }));
        }

        return null;
      },
      VISIBLE_FETCH_CONCURRENCY
    );
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
