import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useMarketStore } from '../store/marketStore';
import { useSocket } from '../hooks/useSocket';
import ExchangeSelector from '../components/market/ExchangeSelector';
import BinanceMarketTable from '../components/market/BinanceMarketTable';
import KLineChart from '../components/charts/KLineChart';
import ChartLayoutSelector, { CHART_LAYOUTS } from '../components/charts/ChartLayoutSelector';
import RealtimeIndicator from '../components/market/RealtimeIndicator';
import Input from '../components/common/Input';
import UserAccountMenu from '../components/common/UserAccountMenu';
import { cn } from '../utils/cn';
import CreateWatchlistModal from '../components/market/CreateWatchlistModal';
import { Link, useNavigate } from 'react-router-dom';
import { Search, X, TrendingUp, Maximize2, Minimize2 } from 'lucide-react';
import { API_BASE_URL, ROUTES } from '../utils/constants';
import { debounce } from 'lodash';
import { testBinanceApi, checkApiConfig } from '../utils/debugApi';

const Market = () => {
  const navigate = useNavigate();

  const {
    exchange,
    exchangeType,
    searchQuery,
    setSearchQuery,
    fetchBinanceTokens,
    loadingBinance,
    binanceTokens,
    selectedToken,
    setSelectedToken,
    chartData,
    loadingChart,
    chartError,
    fetchChartData,
    loadOlderChartData,
    getChartDataForSymbol,
    getChartHistoryMeta,
    subscribeToKline,
    unsubscribeFromKline,
    handleKlineUpdate,
    isRealtimeConnected,
    activeSubscription,
    setRealtimeConnected,
  } = useMarketStore();
  
  const [chartInterval, setChartInterval] = useState('15m');
  const [chartLayout, setChartLayout] = useState('1');
  const [isWatchlistModalOpen, setIsWatchlistModalOpen] = useState(false);
  // Multi-chart: token per slot; when layout has 5 charts, chartSlotTokens[0..4]
  const [chartSlotTokens, setChartSlotTokens] = useState([]);
  // Multi-chart: timeframe per slot; e.g. chartSlotIntervals[0] = '15m'
  const [chartSlotIntervals, setChartSlotIntervals] = useState([]);
  // Which chart slot is focused (user clicked it) — next token click in list assigns to this slot
  const [activeChartSlot, setActiveChartSlot] = useState(null);
  const [rightPanelPercent, setRightPanelPercent] = useState(36);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const splitContainerRef = useRef(null);
  const chartPanelRef = useRef(null);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);

  const layoutConfig = CHART_LAYOUTS.find((l) => l.id === chartLayout) || CHART_LAYOUTS[0];
  const chartCount = layoutConfig.count;
  const gridClass = layoutConfig.gridClass;
  const isMultiChart = chartCount > 1;
  const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  // Default token when none selected (BTC) — stable reference
  const defaultBtcToken = useMemo(
    () => binanceTokens.find((t) => t.fullSymbol === 'BTCUSDT') || { fullSymbol: 'BTCUSDT', symbol: 'BTC' },
    [binanceTokens]
  );

  // Set default selected token to BTC when tokens have loaded and nothing is selected
  useEffect(() => {
    if (binanceTokens.length > 0 && !selectedToken) {
      setSelectedToken(defaultBtcToken);
    }
  }, [binanceTokens.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose function to open modal from ExchangeSelector
  useEffect(() => {
    window.openWatchlistModal = () => {
      setIsWatchlistModalOpen(true);
    };
    return () => {
      delete window.openWatchlistModal;
    };
  }, []);

  const handleCreateWatchlist = (watchlistName) => {
    console.log('Creating watchlist:', watchlistName);
    const watchlistId = useMarketStore.getState().createWatchlist(watchlistName);
    // Automatically select the newly created watchlist
    useMarketStore.getState().selectWatchlist(watchlistId);
    setIsWatchlistModalOpen(false);
  };

  // Initialize socket with kline update handler
  const socket = useSocket({
    onKlineUpdate: handleKlineUpdate,
    onConnect: () => {
      setRealtimeConnected(true);
    },
    onDisconnect: () => {
      setRealtimeConnected(false);
    },
  });

  // Create debounced search function
  const debouncedSearchRef = useRef(
    debounce((query, type) => {
      fetchBinanceTokens(type, query);
    }, 300)
  );

  // Sync chartSlotTokens length with chartCount; when switching to multi, fill all slots with BTC by default
  useEffect(() => {
    if (!isMultiChart) {
      setActiveChartSlot(null);
      return;
    }
    setChartSlotTokens((prev) => {
      const need = chartCount;
      if (prev.length === need) return prev;
      if (prev.length < need) {
        const next = [...prev];
        const fillToken = selectedToken || defaultBtcToken;
        while (next.length < need) {
          next.push(fillToken);
        }
        return next;
      }
      return prev.slice(0, need);
    });
  }, [isMultiChart, chartCount, selectedToken, defaultBtcToken]);

  // Sync chartSlotIntervals length with chartCount
  useEffect(() => {
    if (!isMultiChart) return;
    setChartSlotIntervals((prev) => {
      const need = chartCount;
      if (prev.length === need) return prev;
      if (prev.length < need) {
        const next = [...prev];
        while (next.length < need) {
          next.push(chartInterval);
        }
        return next;
      }
      return prev.slice(0, need);
    });
  }, [isMultiChart, chartCount, chartInterval]);

  // Fetch chart data: single chart = selectedToken; multi = each slot's token
  useEffect(() => {
    if (isMultiChart) {
      chartSlotTokens.forEach((token, index) => {
        if (token?.fullSymbol) {
          const interval = chartSlotIntervals[index] || chartInterval;
          fetchChartData(token.fullSymbol, exchangeType, interval);
        }
      });
    } else if (selectedToken) {
      fetchChartData(selectedToken.fullSymbol, exchangeType, chartInterval);
    }
  }, [isMultiChart, selectedToken, exchangeType, chartInterval, fetchChartData, chartSlotTokens, chartSlotIntervals]);

  // Subscribe to real-time kline updates (single subscription: first slot or selectedToken)
  useEffect(() => {
    if (!socket) return;
    const symbol = isMultiChart && chartSlotTokens[0]?.fullSymbol
      ? chartSlotTokens[0].fullSymbol
      : selectedToken?.fullSymbol;
    const interval = isMultiChart
      ? (chartSlotIntervals[0] || chartInterval)
      : chartInterval;
    if (!symbol) {
      unsubscribeFromKline(socket);
      return;
    }
    subscribeToKline(socket, exchange, symbol, interval, exchangeType);
    return () => unsubscribeFromKline(socket);
  }, [socket, isMultiChart, chartSlotTokens, selectedToken, exchange, exchangeType, chartInterval, chartSlotIntervals, subscribeToKline, unsubscribeFromKline]);

  // When user picks a token from the list: assign to active slot (multi) or set selectedToken (single)
  const handleTokenSelect = useCallback((token) => {
    if (isMultiChart && activeChartSlot !== null) {
      setChartSlotTokens((prev) => {
        const next = [...prev];
        next[activeChartSlot] = token;
        return next;
      });
      const interval = chartSlotIntervals[activeChartSlot] || chartInterval;
      fetchChartData(token.fullSymbol, exchangeType, interval);
      setActiveChartSlot(null);
    } else {
      setSelectedToken(token);
    }
  }, [isMultiChart, activeChartSlot, exchangeType, chartInterval, chartSlotIntervals, fetchChartData, setSelectedToken]);

  // Fetch tokens on mount and when exchange or exchange type changes
  useEffect(() => {
    fetchBinanceTokens(exchangeType, searchQuery);
  }, [exchange, exchangeType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debug helper - expose to window for console access
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.debugMarketApi = () => {
        checkApiConfig();
        testBinanceApi();
      };
      
      window.debugRealtimeStatus = () => {
        console.log('=== Real-time Status ===');
        console.log('Socket:', socket);
        console.log('Socket connected:', socket?.connected);
        console.log('Socket ID:', socket?.id);
        console.log('Active subscription:', activeSubscription);
        console.log('Is realtime connected:', isRealtimeConnected);
        console.log('Chart data length:', chartData?.length);
        console.log('Last candle:', chartData?.[chartData.length - 1]);
        
        // Test subscription status from server
        fetch(`${API_BASE_URL}/market/debug/subscriptions`)
          .then(r => r.json())
          .then(data => {
            console.log('Server subscriptions:', data);
          })
          .catch(e => console.error('Failed to fetch subscriptions:', e));
      };
      
      window.forceResubscribe = () => {
        if (!socket || !selectedToken) {
          console.error('No socket or token selected');
          return;
        }
        console.log('Force resubscribing...');
        unsubscribeFromKline(socket);
        setTimeout(() => {
          subscribeToKline(socket, exchange, selectedToken.fullSymbol, chartInterval, exchangeType);
        }, 1000);
      };
      
      console.log('💡 Debug helpers available:');
      console.log('  - window.debugMarketApi() - Test API connection');
      console.log('  - window.debugRealtimeStatus() - Check realtime subscription status');
      console.log('  - window.forceResubscribe() - Force resubscribe to current token');
    }
  }, [socket, activeSubscription, isRealtimeConnected, chartData, selectedToken, exchange, exchangeType, chartInterval]);

  // Handle search change with debounce
  const handleSearchChange = useCallback((e) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearchRef.current(query, exchangeType);
  }, [exchangeType, setSearchQuery]);

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    fetchBinanceTokens(exchangeType, '');
  }, [exchangeType, setSearchQuery, fetchBinanceTokens]);

  const handleToggleChartFullscreen = useCallback(async () => {
    try {
      const chartPanel = chartPanelRef.current;
      if (!chartPanel) return;

      if (document.fullscreenElement === chartPanel) {
        await document.exitFullscreen();
      } else {
        await chartPanel.requestFullscreen();
      }
    } catch (error) {
      console.error('Failed to toggle chart fullscreen:', error);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const chartPanel = chartPanelRef.current;
      setIsChartFullscreen(!!chartPanel && document.fullscreenElement === chartPanel);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setIsResizingPanels(true);
  }, []);

  useEffect(() => {
    if (!isResizingPanels) return undefined;

    const onMouseMove = (e) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width) return;

      const rawRightPercent = ((rect.right - e.clientX) / rect.width) * 100;
      const clampedRightPercent = Math.min(48, Math.max(26, rawRightPercent));
      setRightPanelPercent(clampedRightPercent);
    };

    const onMouseUp = () => {
      setIsResizingPanels(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizingPanels]);


  return (
    <>
      <CreateWatchlistModal
        isOpen={isWatchlistModalOpen}
        onClose={() => setIsWatchlistModalOpen(false)}
        onSubmit={handleCreateWatchlist}
      />
      <div className="flex flex-col h-screen bg-background overflow-hidden font-sans">
        {/* Page Global Header */}
        <header className="flex items-center justify-between px-4 h-14 border-b border-border bg-surface shrink-0 z-20">
          <button
            type="button"
            onClick={() => navigate(ROUTES.MARKET_MAP)}
            className="group flex items-center gap-2.5 transition-all"
            title="Switch to Market Map"
          >
            <div className="bg-accent/10 p-1.5 rounded-lg border border-accent/20 group-hover:bg-accent/20 transition-colors">
              <TrendingUp className="h-5 w-5 text-accent" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              CryptoAlerts
            </span>
          </button>

          <UserAccountMenu />
        </header>

        <div ref={splitContainerRef} className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Panel - Chart */}
          <div
            ref={chartPanelRef}
            className="bg-surface flex flex-col h-full overflow-hidden min-w-0"
            style={{ width: `${100 - rightPanelPercent}%` }}
          >
            {/* Multi-chart: global header with symbol, Live, timeframes, layout */}
            {isMultiChart && (
              <div className={cn(
                "flex items-center border-b border-border flex-shrink-0",
                isMultiChart ? "justify-between gap-4 px-3 py-2 bg-surface" : "justify-end px-3 py-2"
              )}>
            {isMultiChart ? (
              <>
                <div className="flex items-center gap-3 min-w-0">
                  {activeChartSlot !== null ? (
                    <span className="text-sm font-medium text-textPrimary truncate">
                      Assigning to chart {activeChartSlot + 1}
                      <span className="text-textSecondary font-normal"> — click a token on the right</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-textPrimary truncate">
                        {chartSlotTokens.filter(Boolean).length > 0
                          ? `${chartSlotTokens.filter(Boolean).length} charts`
                          : `Charts`}
                      </span>
                      <RealtimeIndicator
                        isConnected={isRealtimeConnected}
                        isSubscribed={!!activeSubscription}
                      />
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex flex-wrap gap-1">
                    {TIMEFRAMES.map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => {
                          if (activeChartSlot === null) return;
                          setChartSlotIntervals((prev) => {
                            const next = [...prev];
                            while (next.length < chartCount) next.push(chartInterval);
                            next[activeChartSlot] = tf;
                            return next;
                          });
                          const token = chartSlotTokens[activeChartSlot];
                          if (token?.fullSymbol) {
                            fetchChartData(token.fullSymbol, exchangeType, tf);
                          }
                        }}
                        className={cn(
                          'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                          (activeChartSlot !== null
                            ? (chartSlotIntervals[activeChartSlot] || chartInterval) === tf
                            : false)
                            ? 'bg-accent text-white'
                            : 'text-textSecondary hover:bg-surfaceHover hover:text-textPrimary',
                          activeChartSlot === null && 'opacity-50 cursor-not-allowed'
                        )}
                        disabled={activeChartSlot === null}
                        title={activeChartSlot === null ? 'Select a chart first' : `Set chart ${activeChartSlot + 1} timeframe to ${tf}`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                  <ChartLayoutSelector value={chartLayout} onChange={setChartLayout} />
                </div>
              </>
            ) : null}
          </div>
        )}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          {!selectedToken && !isMultiChart ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center max-w-md px-8">
                <h3 className="text-xl font-semibold text-textPrimary mb-2">
                  Select a token to view chart
                </h3>
                <p className="text-textSecondary text-sm">
                  Click on any token in the list to see its price chart
                </p>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "grid flex-1 min-h-0 bg-border",
                isMultiChart ? "gap-1 p-1" : "gap-px",
                gridClass
              )}
              style={{ minHeight: 0 }}
            >
              {Array.from({ length: chartCount }, (_, i) => {
                const isLast = i === chartCount - 1;
                const spanCols = layoutConfig.spanLastCols && isLast ? layoutConfig.spanLastCols : undefined;
                const slotToken = isMultiChart ? chartSlotTokens[i] : selectedToken;
                const slotInterval = isMultiChart ? (chartSlotIntervals[i] || chartInterval) : chartInterval;
                const isActiveSlot = isMultiChart && activeChartSlot === i;
                const slotData = slotToken
                  ? (getChartDataForSymbol(slotToken.fullSymbol, exchangeType, slotInterval) ?? [])
                  : [];
                const slotHistoryMeta = slotToken
                  ? getChartHistoryMeta(slotToken.fullSymbol, exchangeType, slotInterval)
                  : { hasMoreHistory: false };
                const slotLoading = slotToken && loadingChart;
                const slotError = slotToken && chartError;
                return (
                <div
                  key={i}
                  className={cn(
                    "min-h-0 min-w-0 overflow-hidden h-full rounded-lg transition-all duration-200",
                    isMultiChart && "cursor-pointer",
                    isActiveSlot && "ring-[3px] ring-blue-400 shadow-[0_0_12px_2px_rgba(96,165,250,0.6)]"
                  )}
                  style={spanCols ? { gridColumn: `span ${spanCols}` } : undefined}
                  onClick={isMultiChart ? () => setActiveChartSlot(i) : undefined}
                  role={isMultiChart ? "button" : undefined}
                  aria-label={isMultiChart ? `Chart ${i + 1}. Click to choose this chart, then pick a token from the list` : undefined}
                  title={isMultiChart ? `Click to choose this chart, then pick a token from the list` : undefined}
                >
                  {isMultiChart && !slotToken ? (
                    <div
                      className="w-full h-full flex items-center justify-center bg-surface border border-border rounded-lg border-dashed cursor-pointer hover:border-accent/50"
                      onClick={() => setActiveChartSlot(i)}
                      role="button"
                      aria-label={`Chart ${i + 1}. Click to choose, then pick a token`}
                    >
                      <p className="text-textSecondary text-sm text-center px-4">
                        Click here to choose this chart, then pick a token from the list
                      </p>
                    </div>
                  ) : (
                    <KLineChart
                      instanceId={`slot-${i}`}
                      data={slotData}
                      symbol={slotToken?.fullSymbol ?? '—'}
                      interval={slotInterval}
                      timeframePosition="left"
                      headerRightActions={!isMultiChart ? (
                        <div className="flex items-center gap-2 mr-10">
                          <ChartLayoutSelector value={chartLayout} onChange={setChartLayout} />
                          <button
                            type="button"
                            onClick={handleToggleChartFullscreen}
                            className="h-10 w-10 rounded-lg border border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover transition-colors flex items-center justify-center"
                            title={isChartFullscreen ? 'Exit fullscreen' : 'Fullscreen chart'}
                            aria-label={isChartFullscreen ? 'Exit fullscreen' : 'Fullscreen chart'}
                          >
                            {isChartFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                          </button>
                        </div>
                      ) : null}
                      alertExchange={exchange}
                      alertMarket={exchangeType}
                      loading={slotLoading}
                      error={slotError}
                      isRealtimeConnected={isRealtimeConnected}
                      isRealtimeSubscribed={!!activeSubscription && i === 0}
                      compact={isMultiChart}
                      hasMoreHistory={!!slotHistoryMeta?.hasMoreHistory}
                      onLoadMoreHistory={slotToken?.fullSymbol
                        ? async ({ timestamp }) => {
                          return loadOlderChartData(
                            slotToken.fullSymbol,
                            exchangeType,
                            slotInterval,
                            timestamp
                          );
                        }
                        : undefined}
                      onHeaderClick={isMultiChart ? () => setActiveChartSlot(i) : undefined}
                      onTimeframeChange={!isMultiChart ? (newInterval) => {
                        setChartInterval(newInterval);
                        if (selectedToken) {
                          fetchChartData(selectedToken.fullSymbol, exchangeType, newInterval);
                        }
                      } : undefined}
                    />
                  )}
                </div>
              );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chart and token list panels"
        className={cn(
          'w-1 bg-border relative shrink-0 cursor-col-resize hover:bg-accent/70 transition-colors',
          isResizingPanels && 'bg-accent'
        )}
        onMouseDown={handleResizeStart}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      {/* Right Panel - Token List */}
      <div
        className="flex flex-col bg-background min-w-0"
        style={{ width: `${rightPanelPercent}%` }}
      >
        {/* Header */}
        <div className="p-4 border-b border-border bg-surface">
          <div className="flex items-center gap-4">
            <ExchangeSelector />
            <div className="flex-1 relative">
              <Input
                icon={Search}
                placeholder="Search tokens..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="w-full"
              />
              {searchQuery && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-textSecondary hover:text-textPrimary transition-colors"
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          
          {/* Result count */}
          {!loadingBinance && (
            <div className="mt-2 text-sm text-textSecondary">
              {binanceTokens.length} {binanceTokens.length === 1 ? 'token' : 'tokens'} found
            </div>
          )}
        </div>

        {/* Token Table */}
        <div className="flex-1 overflow-auto">
          <BinanceMarketTable
            onTokenSelect={handleTokenSelect}
            highlightToken={isMultiChart && activeChartSlot !== null ? chartSlotTokens[activeChartSlot] : null}
          />
        </div>
      </div>
    </div>
  </div>
    </>
  );
};

export default Market;
