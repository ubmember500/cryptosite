import { create } from 'zustand';
import { marketService } from '../services/marketService';
import api from '../services/api';

const CHART_PAGE_LIMIT = 500;

const getChartHistoryKey = ({ exchange, exchangeType, symbol, interval }) => {
  return `${exchange}:${exchangeType}:${symbol}:${interval}`;
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
  'https://fapi1.binance.com/fapi/v1',
  'https://fapi2.binance.com/fapi/v1',
  'https://fapi3.binance.com/fapi/v1',
];

const BINANCE_FUTURES_INTERVAL_MAP = {
  '1s': '1m',
  '5s': '1m',
  '15s': '1m',
};

const toNumericOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  const tickers = await fetchJsonFromUrls(
    BINANCE_FUTURES_BASE_URLS,
    '/ticker/24hr',
    {},
    (data) => Array.isArray(data)
  );
  const list = Array.isArray(tickers) ? tickers : [];
  const searchLower = searchQuery.trim().toLowerCase();

  const tokens = list
    .filter((ticker) => typeof ticker?.symbol === 'string' && ticker.symbol.endsWith('USDT'))
    .map((ticker) => {
      const token = {
        symbol: ticker.symbol.replace('USDT', ''),
        fullSymbol: ticker.symbol,
        lastPrice: toNumericOrNull(ticker.lastPrice),
        volume24h: toNumericOrNull(ticker.quoteVolume ?? ticker.volume),
        priceChangePercent24h: toNumericOrNull(ticker.priceChangePercent),
        high24h: toNumericOrNull(ticker.highPrice),
        low24h: toNumericOrNull(ticker.lowPrice),
      };
      token.natr = calculateInstantNatr(token);
      return token;
    })
    .filter((token) => {
      if (!searchLower) return true;
      return (
        token.symbol.toLowerCase().includes(searchLower) ||
        token.fullSymbol.toLowerCase().includes(searchLower)
      );
    });

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

  const rows = await fetchJsonFromUrls(
    BINANCE_FUTURES_BASE_URLS,
    '/klines',
    {
      symbol: String(symbol || '').toUpperCase(),
      interval: apiInterval,
      limit: String(apiLimit),
      ...(before ? { endTime: String(Math.floor(Number(before)) - 1) } : {}),
    },
    (data) => Array.isArray(data)
  );

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

  fetchBinanceTokens: async (exchangeType, searchQuery = '', retryCount = 0) => {
    const exchange = get().exchange;
    set({ loadingBinance: true, binanceError: null });
    const useDirectFuturesClientFetch = exchange === 'binance' && exchangeType === 'futures';
    
    // Helper function to check if error is CORS-related
    const isCORSError = (error) => {
      return error.message?.includes('CORS') || 
             error.message?.includes('CORS') ||
             error.message?.includes('cross-origin') ||
             (error.response?.status === 0 && error.message?.includes('Network'));
    };
    
    // Helper function to check if error is retryable (network errors, not 4xx/5xx)
    const isRetryableError = (error) => {
      // Don't retry on 4xx/5xx errors
      if (error.response?.status >= 400) {
        return false;
      }
      
      // Retry on network errors
      return error.code === 'ERR_NETWORK' ||
             error.code === 'ECONNREFUSED' ||
             error.message?.includes('Failed to fetch') ||
             error.message?.includes('Network') ||
             !error.response; // No response means network issue
    };
    
    try {
      if (useDirectFuturesClientFetch) {
        try {
          const directTokens = await fetchBinanceFuturesTokensDirect(searchQuery);
          set({
            binanceTokens: directTokens,
            loadingBinance: false,
            binanceError: null,
          });
          return;
        } catch (directError) {
          console.warn('[MarketStore] Direct Binance Futures fetch failed, falling back to backend:', {
            message: directError.message,
          });
        }
      }

      const params = new URLSearchParams({
        exchangeType,
        ...(searchQuery && { search: searchQuery })
      });
      
      const url = `/market/${exchange}/tokens?${params}`;
      const fullUrl = `${api.defaults.baseURL}${url}`;

      console.log('[MarketStore] Fetching tokens:', {
        exchange,
        url,
        fullUrl,
        exchangeType,
        searchQuery: searchQuery || '(none)',
        retryCount
      });
      
      // Log API configuration BEFORE making request
      console.log('[MarketStore] Making request to:', `${api.defaults.baseURL}${url}`);
      console.log('[MarketStore] API config:', {
        baseURL: api.defaults.baseURL,
        timeout: api.defaults.timeout,
        headers: api.defaults.headers
      });
      
      // Use axios request (includes auth if available)
      let response;
      try {
        response = await api.get(url);
        
        // Log response details AFTER successful request
        console.log('[MarketStore] Response received:', {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          dataKeys: Object.keys(response.data || {}),
          tokenCount: response.data?.tokens?.length
        });
        console.log('[MarketStore] Axios Response:', {
          status: response.status,
          tokenCount: response.data?.tokens?.length,
          exchangeType: response.data?.exchangeType
        });
        
        // Verify data structure
        if (!response.data) {
          throw new Error('Invalid response: no data received');
        }
        
        if (!Array.isArray(response.data.tokens)) {
          console.warn('[MarketStore] tokens is not an array:', {
            type: typeof response.data.tokens,
            value: response.data.tokens,
            dataKeys: Object.keys(response.data)
          });
          throw new Error(`Invalid tokens data: expected array, got ${typeof response.data.tokens}`);
        }
        
        console.log('[MarketStore] Tokens data structure verified:', {
          tokenCount: response.data.tokens.length,
          firstToken: response.data.tokens[0] || null
        });

        const backendReturnedNoFutures =
          useDirectFuturesClientFetch &&
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
        // Check for CORS errors
        if (isCORSError(axiosError)) {
          console.error('[MarketStore] CORS error detected:', {
            message: axiosError.message,
            code: axiosError.code,
            response: axiosError.response,
            fullError: axiosError
          });
          throw new Error('CORS error: Backend CORS configuration issue. Please check server CORS settings.');
        }
        
        // Check if error is retryable and we haven't retried yet
        if (isRetryableError(axiosError) && retryCount === 0) {
          console.warn('[MarketStore] Retryable error detected, retrying after 1 second...', {
            message: axiosError.message,
            code: axiosError.code,
            retryCount: retryCount + 1
          });
          
          // Wait 1 second before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Retry the request
          return get().fetchBinanceTokens(exchangeType, searchQuery, retryCount + 1);
        }

        if (useDirectFuturesClientFetch) {
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
      
      set({
        binanceTokens: response.data.tokens || [],
        loadingBinance: false,
        binanceError: null
      });
    } catch (error) {
      // Enhanced error logging in catch block
      console.error('[MarketStore] ERROR DETAILS (fetchBinanceTokens):', {
        message: error.message,
        code: error.code,
        name: error.name,
        stack: error.stack?.substring(0, 500),
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers
        } : null,
        request: error.request ? 'Request made but no response' : null,
        fullError: error,
        retryCount
      });
      
      // Enhanced error message
      let errorMessage = 'Failed to fetch tokens';
      
      // Handle CORS errors specifically
      if (isCORSError(error) || error.message?.includes('CORS')) {
        errorMessage = 'CORS error: Backend CORS configuration issue. Please check server CORS settings.';
        console.error('[MarketStore] CORS error detected:', {
          message: error.message,
          code: error.code,
          fullError: error
        });
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK' || error.message.includes('Failed to fetch')) {
        errorMessage = 'Cannot connect to server. Please ensure the backend is running on port 5000.';
      } else if (error.response) {
        errorMessage = error.response.data?.error || `Server error: ${error.response.status}`;
      } else if (error.request) {
        errorMessage = 'No response from server. Check if backend is running.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      set({
        binanceError: errorMessage,
        loadingBinance: false,
        binanceTokens: [] // Clear tokens on error
      });
    }
  },
  
  fetchChartData: async (symbol, exchangeType, interval = '15m') => {
    set({ loadingChart: true, chartError: null });
    const exchange = get().exchange;
    const historyKey = getChartHistoryKey({ exchange, exchangeType, symbol, interval });
    const useDirectFuturesClientFetch = exchange === 'binance' && exchangeType === 'futures';
    try {
      const params = new URLSearchParams({
        symbol,
        exchangeType,
        interval,
        limit: String(CHART_PAGE_LIMIT)
      });

      const response = await api.get(`/market/${exchange}/klines?${params}`);
      
      // Verify response
      if (!response.data?.klines || !Array.isArray(response.data.klines)) {
        throw new Error('Invalid chart data format');
      }

      let klines = response.data.klines;
      if (useDirectFuturesClientFetch && (response.data?.upstreamUnavailable || klines.length === 0)) {
        klines = await fetchBinanceFuturesKlinesDirect(symbol, interval, CHART_PAGE_LIMIT);
      }

      const earliestTime = klines.length > 0 ? Number(klines[0].time) : null;
      set((state) => ({
        chartData: klines,
        chartDataMap: { ...state.chartDataMap, [symbol]: klines },
        chartHistoryMap: {
          ...state.chartHistoryMap,
          [historyKey]: {
            earliestTime,
            hasMoreHistory: klines.length >= CHART_PAGE_LIMIT,
            loadingOlder: false,
          },
        },
        loadingChart: false,
        chartError: null
      }));
    } catch (error) {
      if (useDirectFuturesClientFetch) {
        try {
          const klines = await fetchBinanceFuturesKlinesDirect(symbol, interval, CHART_PAGE_LIMIT);
          const earliestTime = klines.length > 0 ? Number(klines[0].time) : null;
          set((state) => ({
            chartData: klines,
            chartDataMap: { ...state.chartDataMap, [symbol]: klines },
            chartHistoryMap: {
              ...state.chartHistoryMap,
              [historyKey]: {
                earliestTime,
                hasMoreHistory: klines.length >= CHART_PAGE_LIMIT,
                loadingOlder: false,
              },
            },
            loadingChart: false,
            chartError: null,
          }));
          return;
        } catch {
          // fall through to normal error handling
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
      const params = new URLSearchParams({
        symbol,
        exchangeType,
        interval,
        limit: String(CHART_PAGE_LIMIT),
        before: String(Math.floor(beforeTimestamp)),
      });

      const response = await api.get(`/market/${exchange}/klines?${params}`);
      const fetchedKlines = Array.isArray(response.data?.klines) ? response.data.klines : [];
      const beforeSeconds = Math.floor(beforeTimestamp / 1000);
      const olderKlines = fetchedKlines.filter((kline) => Number(kline.time) < beforeSeconds);

      set((state) => {
        const currentData = state.chartDataMap[symbol] || state.chartData || [];
        const merged = mergeCandlesByTime(olderKlines, currentData);
        const earliestTime = merged.length > 0 ? Number(merged[0].time) : null;
        const hasMoreHistory = olderKlines.length > 0 && fetchedKlines.length >= CHART_PAGE_LIMIT;
        const isSelectedSymbol = state.selectedToken?.fullSymbol === symbol;

        return {
          ...(isSelectedSymbol && { chartData: merged }),
          chartDataMap: { ...state.chartDataMap, [symbol]: merged },
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

      return olderKlines;
    } catch (error) {
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

  getChartDataForSymbol: (symbol) => {
    return get().chartDataMap[symbol] ?? get().chartData ?? null;
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
    
    // Update chartData and chartDataMap[symbol] - append or update last candle
    set((state) => {
      const currentData = state.chartData || [];
      const currentMapData = state.chartDataMap[symbol] || [];
      const dataToUpdate = currentMapData.length > 0 ? currentMapData : currentData;
      const newCandle = kline;
      
      let nextData;
      if (dataToUpdate.length === 0) {
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
      return {
        ...(isActiveSymbol && { chartData: nextData }),
        chartDataMap: { ...state.chartDataMap, [symbol]: nextData }
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
