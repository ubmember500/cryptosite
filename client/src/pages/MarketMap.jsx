import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useMarketMapStore } from '../store/marketMapStore';
import { useSocket } from '../hooks/useSocket';
import KLineChart from '../components/charts/KLineChart';
import UserAccountMenu from '../components/common/UserAccountMenu';
import Modal from '../components/common/Modal';
import api from '../services/api';
import { ROUTES } from '../utils/constants';

const CARD_HIGHLIGHT_MS = 12000;
const CARD_STALE_MS = 45000;
const DETAIL_CHART_DEFAULT_INTERVAL = '15m';
const DETAIL_CHART_LIMIT = 500;

const formatCompactVolume = (value) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return '0';
  if (numberValue >= 1e9) return `${(numberValue / 1e9).toFixed(2)}B`;
  if (numberValue >= 1e6) return `${(numberValue / 1e6).toFixed(2)}M`;
  if (numberValue >= 1e3) return `${(numberValue / 1e3).toFixed(1)}K`;
  return numberValue.toFixed(0);
};

const getGridLayout = (count) => {
  if (count === 3) return { columns: 3, rows: 1 };
  if (count === 6) return { columns: 3, rows: 2 };
  if (count === 8) return { columns: 4, rows: 2 };
  if (count === 9) return { columns: 3, rows: 3 };
  if (count === 12) return { columns: 4, rows: 3 };
  return { columns: 4, rows: 4 }; // 16
};

const SKELETON_HEIGHTS = [40, 65, 50, 80, 35, 70, 55, 45, 75, 60, 42, 68, 53, 78, 38, 72, 58, 48, 63, 44, 71, 52, 67, 46];

const ChartSkeleton = () => (
  <div className="w-full h-full flex items-end gap-[2px] px-1 pb-1 overflow-hidden">
    {SKELETON_HEIGHTS.map((h, i) => (
      <div
        key={i}
        className="flex-1 min-w-0 rounded-sm animate-pulse bg-border/30"
        style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }}
      />
    ))}
  </div>
);

const MarketMap = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    selectedExchange,
    selectedCount,
    rankedSymbols,
    visibleSymbols,
    klinesBySymbol,
    chartHistoryBySymbol,
    cardLoadingBySymbol,
    cardErrorBySymbol,
    dataUpdatedAtBySymbol,
    changedAtBySymbol,
    cadence,
    loading,
    isRefreshing,
    isRankingRefresh,
    isHydratingVisible,
    isRealtimeConnected,
    activeRealtimeSymbols,
    rankingIsStale,
    rankingWarmupRatio,
    rankingScoredCount,
    error,
    lastUpdated,
    initialize,
    refreshRanking,
    refreshVisibleCharts,
    syncRealtimeSubscriptions,
    clearRealtimeSubscriptions,
    handleRealtimeKlineUpdate,
    loadOlderVisibleHistory,
    setRealtimeConnected,
    setSelectedExchange,
    setChartCount,
  } = useMarketMapStore();

  const socket = useSocket({
    onKlineUpdate: handleRealtimeKlineUpdate,
    onConnect: () => setRealtimeConnected(true),
    onDisconnect: () => setRealtimeConnected(false),
  });

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState(null);
  const [detailInterval, setDetailInterval] = useState(DETAIL_CHART_DEFAULT_INTERVAL);
  const [detailChartData, setDetailChartData] = useState([]);
  const [detailChartLoading, setDetailChartLoading] = useState(false);
  const [detailChartError, setDetailChartError] = useState(null);

  const fetchDetailedChartData = useCallback(async ({ symbol, interval }) => {
    const safeSymbol = String(symbol || '').toUpperCase();
    if (!safeSymbol) return [];

    const params = new URLSearchParams({
      symbol: safeSymbol,
      exchangeType: 'futures',
      interval: interval || DETAIL_CHART_DEFAULT_INTERVAL,
      limit: String(DETAIL_CHART_LIMIT),
    });

    const response = await api.get(`/market/${selectedExchange}/klines?${params.toString()}`);
    const rawKlines = Array.isArray(response?.data?.klines) ? response.data.klines : [];

    return rawKlines
      .map((kline) => ({
        time: Number(kline?.time),
        open: Number(kline?.open),
        high: Number(kline?.high),
        low: Number(kline?.low),
        close: Number(kline?.close),
        volume: Number(kline?.volume || 0),
      }))
      .filter(
        (kline) =>
          Number.isFinite(kline.time) &&
          Number.isFinite(kline.open) &&
          Number.isFinite(kline.high) &&
          Number.isFinite(kline.low) &&
          Number.isFinite(kline.close)
      );
  }, [selectedExchange]);

  const openDetailChart = useCallback((event, symbol, seedData = []) => {
    event.preventDefault();
    event.stopPropagation();
    setDetailSymbol(symbol);
    setDetailInterval(DETAIL_CHART_DEFAULT_INTERVAL);
    setDetailChartData(Array.isArray(seedData) ? seedData : []);
    setDetailChartError(null);
    setIsDetailModalOpen(true);
  }, []);

  const closeDetailChart = useCallback(() => {
    setIsDetailModalOpen(false);
    setDetailSymbol(null);
    setDetailChartData([]);
    setDetailChartError(null);
    setDetailChartLoading(false);
    setDetailInterval(DETAIL_CHART_DEFAULT_INTERVAL);
  }, []);

  useEffect(() => {
    if (!isDetailModalOpen || !detailSymbol) return;

    let cancelled = false;

    const load = async () => {
      setDetailChartLoading(true);
      setDetailChartError(null);

      try {
        const klines = await fetchDetailedChartData({
          symbol: detailSymbol,
          interval: detailInterval,
        });

        if (cancelled) return;

        setDetailChartData(klines);
      } catch (error) {
        if (cancelled) return;
        setDetailChartError(error?.message || 'Failed to load detailed chart');
      } finally {
        if (!cancelled) {
          setDetailChartLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [isDetailModalOpen, detailSymbol, detailInterval, fetchDetailedChartData]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const rankingTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      refreshRanking({ silent: true });
    }, cadence.rankRefreshMs);

    const chartTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      refreshVisibleCharts();
    }, cadence.chartRefreshMs);

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
        return;
      }
      refreshRanking({ silent: true });
      refreshVisibleCharts();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearInterval(rankingTimer);
      clearInterval(chartTimer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [cadence.chartRefreshMs, cadence.rankRefreshMs, refreshRanking, refreshVisibleCharts]);

  useEffect(() => {
    if (!socket) return;
    syncRealtimeSubscriptions(socket);
  }, [socket, visibleSymbols, syncRealtimeSubscriptions]);

  useEffect(() => {
    return () => {
      if (socket) {
        clearRealtimeSubscriptions(socket);
      }
    };
  }, [socket, clearRealtimeSubscriptions]);

  const gridLayout = useMemo(() => getGridLayout(selectedCount), [selectedCount]);
  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${gridLayout.columns}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${gridLayout.rows}, minmax(0, 1fr))`,
    }),
    [gridLayout]
  );

  return (
    <div className="h-screen overflow-hidden bg-background text-textPrimary px-1.5 py-1 md:px-2 md:py-1.5">
      <div className="h-full w-full max-w-none flex flex-col min-h-0">
        <div className="rounded-lg border border-border bg-surface/70 px-2 py-1">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => navigate(ROUTES.MARKET)}
              className="group flex items-center gap-1 transition-all shrink-0"
              title="Go to Market"
            >
              <div className="bg-accent/10 p-0.5 rounded border border-accent/20 group-hover:bg-accent/20 transition-colors">
                <TrendingUp className="h-3.5 w-3.5 text-accent" />
              </div>
              <span className="text-sm font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent leading-none">
                CryptoAlerts
              </span>
            </button>

            <div className="min-w-0 flex items-center justify-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
              {[
                { key: 'binance', label: 'Binance', enabled: true },
                { key: 'bybit', label: 'Bybit', enabled: true },
                { key: 'okx', label: 'OKX', enabled: false },
              ].map((exchange) => (
                <button
                  key={exchange.key}
                  type="button"
                  onClick={() => {
                    if (!exchange.enabled) return;
                    setSelectedExchange(exchange.key);
                  }}
                  disabled={!exchange.enabled}
                  className={[
                    'px-1.5 py-0.5 rounded border text-[10px] leading-3.5',
                    !exchange.enabled
                      ? 'border-border text-textSecondary opacity-60 cursor-not-allowed'
                      : '',
                    selectedExchange === exchange.key
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover',
                  ].join(' ')}
                >
                  {exchange.label}
                </button>
              ))}
            </div>

              <div className="flex items-center gap-1">
              {[3, 6, 8, 9, 12, 16].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setChartCount(count)}
                  className={[
                    'px-1.5 py-0.5 rounded border text-[10px] leading-3.5',
                    selectedCount === count
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover',
                  ].join(' ')}
                >
                  {count}
                </button>
              ))}
              </div>
            </div>

            <UserAccountMenu
              chipClassName="px-1.5 py-0.5 text-xs rounded-lg gap-1 [&>span:first-child]:h-6 [&>span:first-child]:w-6 [&>span:first-child]:text-xs"
              menuClassName="mt-1"
            />
          </div>
        </div>

        <div className="mt-0.5 text-[10px] text-textSecondary leading-3.5 truncate px-0.5">
          {loading ? t('Loading market activity...') : `${rankedSymbols.length} ${t('ranked symbols')}`}
          {isRefreshing || isRankingRefresh || isHydratingVisible ? ` • ${t('Refreshing...')}` : ''}
          {lastUpdated ? ` • ${t('Updated')}: ${new Date(lastUpdated).toLocaleTimeString()}` : ''}
          {isRealtimeConnected ? ` • ${t('Live')}` : ''}
          {rankingIsStale ? ` • ${t('Ranking stale')}` : ''}
          {rankingWarmupRatio < 1
            ? ` • ${t('Warmup')}: ${rankingScoredCount}/${rankedSymbols.length}`
            : ''}
        </div>

        {error ? (
          <div className="mt-1 text-danger text-[11px]">{error}</div>
        ) : null}

        <div className="mt-1 flex-1 min-h-0 overflow-hidden">
          <div className="h-full grid gap-1.5" style={gridStyle}>
          {visibleSymbols.map((row, index) => (
            (() => {
              const symbolData = klinesBySymbol[row.symbol] || [];
              const hasData = symbolData.length > 0;
              const historyMeta = chartHistoryBySymbol[row.symbol] || {};
              const cardError = !hasData ? (cardErrorBySymbol[row.symbol] || null) : null;
              const latestVolume = hasData ? Number(symbolData[symbolData.length - 1]?.volume || 0) : 0;
              const formattedVolume = formatCompactVolume(latestVolume);

              return (
                <div
                  key={row.symbol}
                  className="rounded border border-border bg-surface p-1.5 transition-colors h-full min-h-0 flex flex-col"
                >
                  <div className="px-0.5 pb-0.5">
                    <div className="font-medium text-sm leading-4 truncate">{row.symbol}</div>
                  </div>

                  <div className="flex-1 min-h-0 relative">
                    <div className="absolute left-2 top-2 z-20 pointer-events-none select-none">
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-accent/60 bg-surface/85 text-accent text-[10px] leading-3 font-semibold">
                        <span>{row.activityScore.toFixed(2)}</span>
                        <span>%</span>
                        <span className="text-[11px] leading-3">🚀</span>
                      </div>
                      {hasData && <div className="mt-0.5 text-[9px] leading-3 text-textSecondary">VOL {formattedVolume}</div>}
                    </div>

                    {hasData ? (
                      <div
                        className="h-full"
                        onContextMenu={(event) => openDetailChart(event, row.symbol, symbolData)}
                        title="Right click to open detailed chart"
                      >
                        <KLineChart
                          data={symbolData}
                          symbol={row.symbol}
                          interval="5m"
                          alertExchange={selectedExchange}
                          alertMarket="futures"
                          loading={false}
                          error={null}
                          className="h-full"
                          compact
                          hideCompactHeader
                          instanceId={`market-map-${row.symbol}`}
                          isRealtimeConnected={isRealtimeConnected}
                          isRealtimeSubscribed={Array.isArray(activeRealtimeSymbols) && activeRealtimeSymbols.includes(row.symbol)}
                          hasMoreHistory={!!historyMeta.hasMoreHistory}
                          showInlineVolumeOverlay
                          showCenterWatermark
                          watermarkText={row.symbol.replace(/(USDT|USDC|USD|BUSD|FDUSD|TUSD|USDE)$/i, '')}
                          watermarkOpacity={0.08}
                          onLoadMoreHistory={async ({ timestamp }) => {
                            return loadOlderVisibleHistory(row.symbol, timestamp);
                          }}
                        />
                      </div>
                    ) : cardError ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-[10px] text-danger/70 text-center px-2">{cardError}</span>
                      </div>
                    ) : (
                      <ChartSkeleton />
                    )}
                  </div>
                </div>
              );
            })()
          ))}
          </div>
        </div>
      </div>

      <Modal
        isOpen={isDetailModalOpen}
        onClose={closeDetailChart}
        title={detailSymbol ? `${detailSymbol} • ${detailInterval}` : 'Detailed chart'}
        size="xl"
      >
        <div className="w-full h-[70vh] min-h-[560px]">
          <KLineChart
            data={detailChartData}
            symbol={detailSymbol || '—'}
            interval={detailInterval}
            onTimeframeChange={setDetailInterval}
            alertExchange={selectedExchange}
            alertMarket="futures"
            loading={detailChartLoading}
            error={detailChartError}
            className="h-full"
            compact={false}
            instanceId={detailSymbol ? `market-map-detail-${detailSymbol}` : 'market-map-detail'}
            isRealtimeConnected={isRealtimeConnected}
            isRealtimeSubscribed={
              detailInterval === '5m' &&
              Array.isArray(activeRealtimeSymbols) &&
              activeRealtimeSymbols.includes(detailSymbol)
            }
          />
        </div>
      </Modal>
    </div>
  );
};

export default MarketMap;
