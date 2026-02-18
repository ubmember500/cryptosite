import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Building2 } from 'lucide-react';
import { useWallScannerStore } from '../../store/wallScannerStore';
import { cn } from '../../utils/cn';

const EXCHANGE_PRESETS = [
  { key: 'binance', title: 'Binance', exchange: 'binance', market: 'futures', minVolume: 350000, enabled: true },
];

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

const ScannerSettings = () => {
  const { t } = useTranslation();
  const { depth, radius, updateSettings, restartScan, isRunning } = useWallScannerStore();
  const [exchangeFilters, setExchangeFilters] = useState(EXCHANGE_PRESETS);

  const restartTimerRef = useRef(null);

  const updateExchangeFilter = (key, patch) => {
    setExchangeFilters((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  };

  // Debounced restart: waits 500ms after last settings change before restarting scan
  const debouncedRestart = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
    }
    restartTimerRef.current = setTimeout(() => {
      restartScan();
    }, 500);
  }, [restartScan]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
    };
  }, []);

  // Sync enabled cards to store as cardConfigs and trigger debounced restart
  useEffect(() => {
    const enabledFilters = exchangeFilters.filter((item) => item.enabled);

    const cardConfigs = enabledFilters.map((item) => ({
      exchange: item.exchange,
      market: item.market,
      minVolume: item.minVolume,
    }));

    updateSettings({ cardConfigs });

    // Only restart if scanner is already running (initial start is handled by WallScanner page)
    if (isRunning) {
      debouncedRestart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeFilters]);

  // Restart scan when depth or radius changes (if already running)
  const depthRef = useRef(depth);
  const radiusRef = useRef(radius);
  useEffect(() => {
    if (depthRef.current !== depth || radiusRef.current !== radius) {
      depthRef.current = depth;
      radiusRef.current = radius;
      if (isRunning) {
        debouncedRestart();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth, radius]);

  const allEnabled = exchangeFilters.every((item) => item.enabled);

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-blue-500/30 p-3 bg-blue-500/5">
        <div className="flex items-center gap-2 text-sm font-medium text-textPrimary">
          <Filter size={16} className="text-blue-300" />
          {t('Large order filters by exchange')}
        </div>
        <button
          type="button"
          onClick={() =>
            setExchangeFilters((prev) => prev.map((item) => ({ ...item, enabled: !allEnabled })))
          }
          className={cn(
            'h-5 w-10 rounded-full transition-colors relative',
            allEnabled ? 'bg-blue-400/80' : 'bg-surfaceHover'
          )}
          aria-label={t('Toggle all exchanges')}
        >
          <span
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-black transition-transform',
              allEnabled ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
        </button>
      </div>

      {/* Controls row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-textPrimary">
            {t('Depth')}: {depth}%
          </label>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={depth}
            onChange={(e) => updateSettings({ depth: Number(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-400 bg-blue-500/20"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-textPrimary">
            {t('Radius')}: {radius}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={radius}
            onChange={(e) => updateSettings({ radius: Number(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-400 bg-blue-500/20"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 bg-surface/60">
        <p className="text-xs text-textSecondary">
          {t('Set minimum large order amount (USDT) per exchange and market type.')}
        </p>
      </div>

      {/* Exchange filters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {exchangeFilters.map((item) => (
          <div
            key={item.key}
            className={cn(
              'rounded-lg border p-3 space-y-3',
              item.enabled
                ? 'border-blue-500/45 bg-blue-500/5'
                : 'border-border bg-surface/60'
            )}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
                <Building2 size={14} className="text-textSecondary" />
                {item.title}
              </h4>
              <button
                type="button"
                onClick={() => updateExchangeFilter(item.key, { enabled: !item.enabled })}
                className={cn(
                  'h-5 w-10 rounded-full transition-colors relative',
                  item.enabled ? 'bg-blue-400/80' : 'bg-surfaceHover'
                )}
                aria-label={t('Toggle {{name}}', { name: item.title })}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-black transition-transform',
                    item.enabled ? 'translate-x-5' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-textSecondary">{t('Market')}</p>
              <select
                value={item.market}
                onChange={(e) => updateExchangeFilter(item.key, { market: e.target.value })}
                disabled
                className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-sm text-textPrimary"
              >
                <option value="futures">{t('Futures')}</option>
              </select>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-textSecondary">{t('Minimum order size, USDT')}</p>
              <input
                type="number"
                min={50000}
                max={100000000}
                step={50000}
                value={item.minVolume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  updateExchangeFilter(item.key, {
                    minVolume: Number.isFinite(val) ? clamp(val, 50000, 100000000) : item.minVolume,
                  });
                }}
                className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-sm text-textPrimary"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() =>
                    updateExchangeFilter(item.key, {
                      minVolume: clamp(item.minVolume - 50000, 50000, 100000000),
                    })
                  }
                  className="h-7 w-7 rounded bg-surfaceHover text-blue-300"
                >
                  -
                </button>
                <span className="text-sm font-semibold text-textPrimary">
                  {item.minVolume.toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateExchangeFilter(item.key, {
                      minVolume: clamp(item.minVolume + 50000, 50000, 100000000),
                    })
                  }
                  className="h-7 w-7 rounded bg-surfaceHover text-blue-300"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScannerSettings;
