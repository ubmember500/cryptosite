import React, { useMemo, useState, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useWallScannerStore } from '../../store/wallScannerStore';
import LoadingSpinner from '../common/LoadingSpinner';

const Plot = lazy(() =>
  import('plotly.js-dist-min').then((Plotly) =>
    import('react-plotly.js/factory').then((factory) => ({
      default: factory.default(Plotly.default),
    }))
  )
);

const DensityHeatmap = () => {
  const { t } = useTranslation();
  const { walls, densityMaps, densityMeta, fetchDensity, cardConfigs, depth } = useWallScannerStore();

  const mapKeys = useMemo(() => {
    const fromWalls = Array.from(
      new Set(
        (walls || [])
          .filter((w) => w.exchange && w.symbol)
          .map((w) => `${w.exchange}:${w.symbol}`)
      )
    );
    return fromWalls;
  }, [walls]);
  const [selectedKey, setSelectedKey] = useState('');

  const activeKey = mapKeys.includes(selectedKey) ? selectedKey : mapKeys[0] || '';
  const mapData = densityMaps[activeKey];
  const activeMinVolume = useMemo(() => {
    if (!activeKey) return 300000;
    const [exchange] = activeKey.split(':');
    const cfg = (cardConfigs || []).find((item) => item.exchange === exchange);
    return Number.isFinite(Number(cfg?.minVolume)) ? Number(cfg.minVolume) : 300000;
  }, [activeKey, cardConfigs]);

  const hasFreshMap = useMemo(() => {
    if (!activeKey || !mapData) return false;
    const meta = densityMeta?.[activeKey];
    if (!meta) return false;
    return Number(meta.depth) === Number(depth)
      && Number(meta.minVolume) === Number(activeMinVolume);
  }, [activeKey, mapData, densityMeta, depth, activeMinVolume]);

  React.useEffect(() => {
    if (!activeKey || hasFreshMap) return;
    const [exchange, symbol] = activeKey.split(':');
    if (exchange && symbol) {
      fetchDensity(exchange, symbol, activeMinVolume);
    }
  }, [activeKey, hasFreshMap, fetchDensity, activeMinVolume]);

  const handleSelectChange = useCallback(
    (e) => {
      const key = e.target.value;
      setSelectedKey(key);

      const selectedExchange = key ? key.split(':')[0] : '';
      const selectedCfg = (cardConfigs || []).find((item) => item.exchange === selectedExchange);
      const selectedMinVolume = Number.isFinite(Number(selectedCfg?.minVolume))
        ? Number(selectedCfg.minVolume)
        : 300000;

      const keyMeta = key ? densityMeta?.[key] : null;
      const keyHasFreshMap = key
        && densityMaps[key]
        && keyMeta
        && Number(keyMeta.depth) === Number(depth)
        && Number(keyMeta.minVolume) === Number(selectedMinVolume);

      if (key && !keyHasFreshMap) {
        const [exchange, symbol] = key.split(':');
        if (exchange && symbol) {
          fetchDensity(exchange, symbol, selectedMinVolume);
        }
      }
    },
    [densityMaps, densityMeta, fetchDensity, depth, cardConfigs]
  );

  const { bidTrace, askTrace, midPrice, displaySymbol } = useMemo(() => {
    if (!mapData) return { bidTrace: null, askTrace: null, midPrice: null, displaySymbol: '' };

    const bids = mapData.bids || [];
    const asks = mapData.asks || [];
    const mid = mapData.midPrice;
    const sym = activeKey.includes(':') ? activeKey.split(':')[1] : activeKey;

    const bidTrace = {
      type: 'bar',
      orientation: 'h',
      name: t('Bids'),
      y: bids.map((b) => b.priceLevel),
      x: bids.map((b) => b.volumeUSD),
      marker: {
        color: 'rgba(34, 197, 94, 0.6)',
        line: { color: 'rgba(34, 197, 94, 0.9)', width: 1 },
      },
      hovertemplate: '%{y:.2f}<br>$%{x:,.0f}<extra>BID</extra>',
    };

    const askTrace = {
      type: 'bar',
      orientation: 'h',
      name: t('Asks'),
      y: asks.map((a) => a.priceLevel),
      x: asks.map((a) => a.volumeUSD),
      marker: {
        color: 'rgba(59, 130, 246, 0.6)',
        line: { color: 'rgba(59, 130, 246, 0.9)', width: 1 },
      },
      hovertemplate: '%{y:.2f}<br>$%{x:,.0f}<extra>ASK</extra>',
    };

    return { bidTrace, askTrace, midPrice: mid, displaySymbol: sym };
  }, [mapData, activeKey, t]);

  const layout = useMemo(() => {
    const midFormatted =
      midPrice != null
        ? `$${Number(midPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '';
    const titleText = displaySymbol
      ? `${displaySymbol} ${t('Density Map')}${midFormatted ? ` | ${t('Mid')}: ${midFormatted}` : ''}`
      : t('Order Book Density');

    return {
      title: {
        text: titleText,
        font: { color: '#e2e8f0', size: 14 },
      },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#94a3b8' },
      barmode: 'overlay',
      bargap: 0.08,
      xaxis: {
        title: { text: t('Volume (USD)'), font: { size: 12 } },
        gridcolor: 'rgba(148, 163, 184, 0.1)',
        zerolinecolor: 'rgba(148, 163, 184, 0.15)',
        tickformat: ',.0s',
      },
      yaxis: {
        title: { text: t('Price Level'), font: { size: 12 } },
        gridcolor: 'rgba(148, 163, 184, 0.1)',
        zerolinecolor: 'rgba(148, 163, 184, 0.15)',
        autorange: true,
      },
      legend: {
        orientation: 'h',
        x: 0.5,
        xanchor: 'center',
        y: 1.08,
        font: { size: 12 },
      },
      margin: { l: 90, r: 20, t: 60, b: 50 },
      hovermode: 'closest',
      shapes:
        midPrice != null
          ? [
              {
                type: 'line',
                x0: 0,
                x1: 1,
                xref: 'paper',
                y0: midPrice,
                y1: midPrice,
                line: { color: 'rgba(96, 165, 250, 0.6)', width: 1.5, dash: 'dash' },
              },
            ]
          : [],
    };
  }, [midPrice, displaySymbol, t]);

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  if (mapKeys.length === 0) {
    return <div className="h-64 bg-surface rounded-xl border border-border" />;
  }

  return (
    <div className="space-y-3">
      {/* Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-textSecondary">
          {t('Order Book')}:
        </label>
        <select
          value={activeKey}
          onChange={handleSelectChange}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
        >
          {mapKeys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </div>

      {/* Chart */}
      <div className="bg-surface rounded-xl border border-border p-4 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-[480px]">
              <LoadingSpinner size="lg" />
            </div>
          }
        >
          {bidTrace && askTrace ? (
            <Plot
              data={[bidTrace, askTrace]}
              layout={layout}
              config={config}
              useResizeHandler
              className="w-full"
              style={{ width: '100%', minHeight: '480px' }}
            />
          ) : (
            <div className="h-64" />
          )}
        </Suspense>
      </div>
    </div>
  );
};

export default DensityHeatmap;
