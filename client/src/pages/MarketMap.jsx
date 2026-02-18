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
    <div className="h-screen overflow-hidden bg-background text-textPrimary px-3 py-3 md:px-4 md:py-4">
      <div className="h-full w-full max-w-none flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <button
            type="button"
            onClick={() => navigate(ROUTES.MARKET)}
            className="group flex items-center gap-2.5 transition-all"
            title="Go to Market"
          >
            <div className="bg-accent/10 p-1.5 rounded-lg border border-accent/20 group-hover:bg-accent/20 transition-colors">
              <TrendingUp className="h-6 w-6 text-accent" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              CryptoAlerts
            </span>
          </button>
          <UserAccountMenu />
        </div>

        <div className="flex justify-center mb-2">
          <div className="flex items-center gap-8 flex-wrap justify-center">
            <div className="flex items-center gap-2">
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
                    'px-3 py-1.5 rounded border text-sm',
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

            <div className="flex items-center gap-2">
              {[3, 6, 8, 9, 12, 16].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setChartCount(count)}
                  className={[
                    'px-3 py-1.5 rounded border text-sm',
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
        </div>

        <div className="mt-4 text-sm text-textSecondary">
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
          <div className="mt-4 text-danger text-sm">{error}</div>
        ) : null}

        <div className="mt-3 flex-1 min-h-0 overflow-hidden">
          <div className="h-full grid gap-2" style={gridStyle}>
          {visibleSymbols.map((row, index) => (
            (() => {
              const symbolData = klinesBySymbol[row.symbol] || [];
              const hasData = symbolData.length > 0;
              const cardError = !hasData ? (cardErrorBySymbol[row.symbol] || null) : null;
              const changedAt = Number(changedAtBySymbol[row.symbol] || 0);
              const isRecentlyChanged = changedAt > 0 && Date.now() - changedAt < CARD_HIGHLIGHT_MS;
              const dataUpdatedAt = Number(dataUpdatedAtBySymbol[row.symbol] || 0);
              const isStaleData = hasData && dataUpdatedAt > 0 && Date.now() - dataUpdatedAt > CARD_STALE_MS;

              return (
                <div
                  key={row.symbol}
                  className={[
                    'rounded border bg-surface p-2 transition-colors h-full min-h-0 flex flex-col',
                    isRecentlyChanged
                      ? 'border-accent/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]'
                      : 'border-border',
                  ].join(' ')}
                >
                  <div className="px-1 pb-1">
                    <div className="text-xs text-textSecondary">#{index + 1}</div>
                    <div className="font-medium flex items-center gap-2">
                      <span>{row.symbol}</span>
                      {row.activityMetric === 'change5m_warmup' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-textSecondary">
                          {t('Warmup')}
                        </span>
                      ) : null}
                      {isRecentlyChanged ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent/60 text-accent">
                          {t('Active now')}
                        </span>
                      ) : null}
                      {isStaleData ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-warning/60 text-warning">
                          {t('Stale')}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-textSecondary mt-1">
                      {t('5m activity')}
                      : {row.activityScore.toFixed(3)}%
                    </div>
                  </div>

                  <div className="flex-1 min-h-0">
                    <KLineChart
                      data={symbolData}
                      symbol={row.symbol}
                      interval="5m"
                      loading={Boolean(cardLoadingBySymbol[row.symbol]) && !hasData}
                      error={cardError}
                      className="h-full"
                      compact
                      instanceId={`market-map-${row.symbol}`}
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
