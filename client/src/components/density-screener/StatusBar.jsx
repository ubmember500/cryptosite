import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { useDensityScreenerStore } from '../../store/densityScreenerStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(timestamp) {
  if (!timestamp) return 'never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function getScanStatus(lastScanAt, error) {
  if (error) return 'error';
  if (!lastScanAt) return 'inactive';
  const age = (Date.now() - lastScanAt) / 1000;
  if (age < 60) return 'active';
  if (age <= 120) return 'stale';
  return 'error';
}

function formatMarket(market) {
  if (!market) return '';
  const first = market.charAt(0).toUpperCase();
  return first; // "F" for futures, "S" for spot, etc.
}

function exchangeDisplayName(exchange) {
  if (!exchange) return '';
  return exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

const EXCHANGE_COLORS = {
  binance: 'text-yellow-400',
  bybit: 'text-orange-400',
  okx: 'text-blue-400',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }) {
  const colors = {
    active: 'bg-green-500',
    stale: 'bg-yellow-500',
    error: 'bg-red-500',
    inactive: 'bg-gray-500',
  };
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${colors[status] || colors.inactive} ${status === 'active' ? 'animate-pulse' : ''}`}
    />
  );
}

function ExchangeBadge({ exchangeKey, data }) {
  const status = getScanStatus(data.lastScanAt, data.error);
  const colorClass = EXCHANGE_COLORS[data.exchange] || 'text-textSecondary';
  const durationSec = data.lastScanDurationMs != null ? (data.lastScanDurationMs / 1000).toFixed(1) : null;

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <StatusDot status={status} />
      <span className={`font-medium ${colorClass}`}>
        {exchangeDisplayName(data.exchange)} {formatMarket(data.market)}
      </span>
      <span className="text-textSecondary">
        {timeAgo(data.lastScanAt)}
      </span>
      {durationSec && (
        <span className="text-textSecondary opacity-60">~{durationSec}s</span>
      )}
      {data.error && (
        <span className="text-red-400" title={data.error}>
          <AlertTriangle className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------

export default function StatusBar() {
  const { scannerStatus, isFetching, lastUpdated } = useDensityScreenerStore();

  // Force a re-render every 5 s so relative times stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const exchanges = scannerStatus?.exchanges ?? {};
  const exchangeKeys = Object.keys(exchanges);
  const totalTracked = scannerStatus?.tracker?.totalTracked ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface/50 px-3 py-1.5 text-xs text-textSecondary">
      {/* Per-exchange indicators */}
      {exchangeKeys.map((key) => (
        <ExchangeBadge key={key} exchangeKey={key} data={exchanges[key]} />
      ))}

      {/* Separator */}
      {exchangeKeys.length > 0 && (
        <span className="hidden sm:inline text-border">|</span>
      )}

      {/* Total walls tracked */}
      <div className="flex items-center gap-1 whitespace-nowrap">
        <Activity className="h-3 w-3 text-textSecondary" />
        <span>{totalTracked} walls tracked</span>
      </div>

      {/* Separator */}
      <span className="hidden sm:inline text-border">|</span>

      {/* Auto-refresh / last updated */}
      <div className="flex items-center gap-1.5 whitespace-nowrap ml-auto">
        {isFetching ? (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            <RefreshCw className="h-3 w-3 animate-spin text-green-400" />
            <span className="text-green-400">Refreshing…</span>
          </>
        ) : (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500/60" />
            <span>Auto-refresh</span>
          </>
        )}
        {lastUpdated && (
          <span className="opacity-60">· {timeAgo(new Date(lastUpdated).getTime())}</span>
        )}
      </div>
    </div>
  );
}
