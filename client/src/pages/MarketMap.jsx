import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useMarketMapStore } from '../store/marketMapStore';
import { useSocket } from '../hooks/useSocket';
import KLineChart from '../components/charts/KLineChart';
import UserAccountMenu from '../components/common/UserAccountMenu';
import { ROUTES } from '../utils/constants';

const CARD_HIGHLIGHT_MS = 12000;
const CARD_STALE_MS = 45000;

const getGridLayout = (count) => {
  if (count === 3) return { columns: 3, rows: 1 };
  if (count === 6) return { columns: 3, rows: 2 };
  if (count === 8) return { columns: 4, rows: 2 };
  if (count === 9) return { columns: 3, rows: 3 };
  if (count === 12) return { columns: 4, rows: 3 };
  return { columns: 4, rows: 4 }; // 16
};

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
              const changedAt = Number(changedAtBySymbol[row.symbol] || 0);
              const isRecentlyChanged = changedAt > 0 && Date.now() - changedAt < CARD_HIGHLIGHT_MS;
              const dataUpdatedAt = Number(dataUpdatedAtBySymbol[row.symbol] || 0);
              const isStaleData = hasData && dataUpdatedAt > 0 && Date.now() - dataUpdatedAt > CARD_STALE_MS;

              return (
                <div
                  key={row.symbol}
                  className={[
                    'rounded border bg-surface p-1.5 transition-colors h-full min-h-0 flex flex-col',
                    isRecentlyChanged
                      ? 'border-accent/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]'
                      : 'border-border',
                  ].join(' ')}
                >
                  <div className="px-0.5 pb-0.5">
                    <div className="text-[10px] text-textSecondary leading-3">#{index + 1}</div>
                    <div className="font-medium text-sm leading-4 flex items-center gap-1.5">
                      <span>{row.symbol}</span>
                      {row.activityMetric === 'change5m_warmup' ? (
                        <span className="text-[9px] px-1 py-0.5 rounded border border-border text-textSecondary leading-3">
                          {t('Warmup')}
                        </span>
                      ) : null}
                      {isRecentlyChanged ? (
                        <span className="text-[9px] px-1 py-0.5 rounded border border-accent/60 text-accent leading-3">
                          {t('Active now')}
                        </span>
                      ) : null}
                      {isStaleData ? (
                        <span className="text-[9px] px-1 py-0.5 rounded border border-warning/60 text-warning leading-3">
                          {t('Stale')}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-textSecondary mt-0.5 leading-3">
                      NATR 5m
                      {row.activityMetric === 'change5m_warmup' ? ' (est)' : ''}
                      : {row.activityScore.toFixed(3)}%
                    </div>
                  </div>

                  <div className="flex-1 min-h-0">
                    <KLineChart
                      data={symbolData}
                      symbol={row.symbol}
                      interval="5m"
                      alertExchange={selectedExchange}
                      alertMarket="futures"
                      loading={Boolean(cardLoadingBySymbol[row.symbol]) && !hasData}
                      error={cardError}
                      className="h-full"
                      compact
                      instanceId={`market-map-${row.symbol}`}
                      isRealtimeConnected={isRealtimeConnected}
                      isRealtimeSubscribed={Array.isArray(activeRealtimeSymbols) && activeRealtimeSymbols.includes(row.symbol)}
                      hasMoreHistory={!!historyMeta.hasMoreHistory}
                      showVolumeIndicator
                      showCenterWatermark
                      watermarkText={row.symbol.replace(/(USDT|USDC|USD|BUSD|FDUSD|TUSD|USDE)$/i, '')}
                      watermarkOpacity={0.08}
                      onLoadMoreHistory={async ({ timestamp }) => {
                        return loadOlderVisibleHistory(row.symbol, timestamp);
                      }}
                    />
                  </div>

                  {!cardLoadingBySymbol[row.symbol] && !cardErrorBySymbol[row.symbol] && !hasData ? (
                    <div className="text-xs text-textSecondary px-1 pt-1">{t('No chart data for this symbol yet')}</div>
                  ) : null}
                </div>
              );
            })()
          ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketMap;
