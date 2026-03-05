import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDensityScreenerStore } from '../../store/densityScreenerStore';
import { cn } from '../../utils/cn';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  ExternalLink,
  Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCHANGE_COLORS = {
  binance: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  bybit: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  okx: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

const COLUMNS = [
  { key: 'exchange', label: 'Exchange', sortable: true },
  { key: 'symbol', label: 'Symbol', sortable: true },
  { key: 'side', label: 'Side', sortable: true },
  { key: 'price', label: 'Price', sortable: true },
  { key: 'volumeUSD', label: 'Volume USD', sortable: true },
  { key: 'percentFromMid', label: '% From Mid', sortable: true },
  { key: 'wallAgeMs', label: 'Wall Age', sortable: true },
  { key: 'link', label: 'Trade', sortable: false, hideMobile: true },
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPrice(price) {
  if (price == null) return '—';
  if (price >= 1000)
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (price >= 1)
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  if (price >= 0.01)
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  });
}

function formatUSD(value) {
  if (value == null) return '—';
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatAge(ms) {
  if (ms == null || ms < 0) return '—';
  if (ms < 60000) return '< 1m';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function getTradeLink(wall) {
  const { exchange, symbol, originalSymbol, market } = wall;
  const base = symbol.replace(/USDT$/, '');
  switch (exchange) {
    case 'binance':
      return market === 'futures'
        ? `https://www.binance.com/en/futures/${symbol}`
        : `https://www.binance.com/en/trade/${base}_USDT`;
    case 'bybit':
      return market === 'futures'
        ? `https://www.bybit.com/trade/usdt/${symbol}`
        : `https://www.bybit.com/en/trade/spot/${base}/USDT`;
    case 'okx':
      return market === 'futures'
        ? `https://www.okx.com/trade-swap/${originalSymbol || `${base}-USDT-SWAP`}`
        : `https://www.okx.com/trade-spot/${originalSymbol || `${base}-USDT`}`;
    default:
      return '#';
  }
}

function formatLastUpdated(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function SkeletonRows({ count = 8 }) {
  return Array.from({ length: count }, (_, i) => (
    <tr key={i} className="border-b border-border animate-pulse">
      {COLUMNS.map((col) => (
        <td
          key={col.key}
          className={cn('px-4 py-3', col.hideMobile && 'hidden md:table-cell')}
        >
          <div className="h-4 bg-surfaceHover rounded w-3/4" />
        </td>
      ))}
    </tr>
  ));
}

// ---------------------------------------------------------------------------
// DensityTable component
// ---------------------------------------------------------------------------

const DensityTable = () => {
  const { t } = useTranslation();
  const {
    walls,
    loading,
    lastUpdated,
    isFetching,
    exportCSV,
    filters,
    updateFilter,
  } = useDensityScreenerStore();

  // Current sort from store
  const sortKey = filters.sort || 'volumeUSD';
  const sortDir = filters.order || 'desc';

  // ── Sorting ────────────────────────────────────────────────

  const handleSort = (key) => {
    const col = COLUMNS.find((c) => c.key === key);
    if (!col?.sortable) return;

    if (sortKey === key) {
      updateFilter('order', sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      updateFilter('sort', key);
      updateFilter('order', 'desc');
    }
    // Trigger a fetch so the server returns data in the new sort order
    setTimeout(() => useDensityScreenerStore.getState().fetchWalls(), 50);
  };

  const getSortIcon = (key) => {
    if (sortKey !== key)
      return <ArrowUpDown size={14} className="text-textSecondary/50" />;
    return sortDir === 'asc' ? (
      <ArrowUp size={14} className="text-accent" />
    ) : (
      <ArrowDown size={14} className="text-accent" />
    );
  };

  // ── Sorted data (local re-sort as safety net) ─────────────

  const sorted = useMemo(() => {
    if (!walls?.length) return [];
    const data = [...walls];
    data.sort((a, b) => {
      let aVal = a[sortKey];
      let bVal = b[sortKey];
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [walls, sortKey, sortDir]);

  // ── Loading state ─────────────────────────────────────────

  if (loading && walls.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-textPrimary">
            <thead className="text-xs uppercase bg-surface border-b border-border">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'px-4 py-3 font-medium text-textSecondary whitespace-nowrap',
                      col.hideMobile && 'hidden md:table-cell',
                    )}
                  >
                    {t(col.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SkeletonRows />
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────

  if (!walls || walls.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border flex flex-col items-center justify-center py-16 px-4 text-center">
        <p className="text-textSecondary text-sm">
          {t('No walls found. Try adjusting your filters.')}
        </p>
      </div>
    );
  }

  // ── Table ─────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-textSecondary">
          <span className="font-medium text-textPrimary">
            {sorted.length} {t('walls found')}
          </span>

          {lastUpdated && (
            <span>
              {t('Updated')} {formatLastUpdated(lastUpdated)}
            </span>
          )}

          {isFetching && (
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-green-400">{t('Refreshing')}</span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={exportCSV}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover transition-colors"
        >
          <Download size={14} />
          {t('Export CSV')}
        </button>
      </div>

      {/* Data table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-textPrimary">
            <thead className="text-xs uppercase bg-surface border-b border-border sticky top-0 z-10">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      'px-4 py-3 font-medium text-textSecondary whitespace-nowrap',
                      col.sortable &&
                        'cursor-pointer hover:text-textPrimary transition-colors select-none',
                      col.hideMobile && 'hidden md:table-cell',
                    )}
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {t(col.label)}
                      {col.sortable && getSortIcon(col.key)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {sorted.map((wall, i) => {
                const isBid = wall.side === 'BID';
                const exKey = wall.exchange?.toLowerCase();
                const tradeUrl = getTradeLink(wall);
                const isEven = i % 2 === 0;
                const isFresh = wall.wallAgeMs != null && wall.wallAgeMs < 120000;

                // Row highlight based on volume
                let volumeHighlight = '';
                if (wall.volumeUSD >= 5_000_000) volumeHighlight = 'bg-yellow-500/10';
                else if (wall.volumeUSD >= 1_000_000) volumeHighlight = 'bg-yellow-500/5';

                return (
                  <tr
                    key={`${wall.exchange}-${wall.symbol}-${wall.price}-${wall.side}-${i}`}
                    className={cn(
                      'border-b border-border transition-colors',
                      isBid
                        ? 'border-l-4 border-l-green-500'
                        : 'border-l-4 border-l-red-500',
                      volumeHighlight ||
                        (isEven ? 'bg-surface' : 'bg-surfaceHover/30'),
                      'hover:bg-surfaceHover/60',
                    )}
                  >
                    {/* Exchange */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase border',
                          EXCHANGE_COLORS[exKey] ||
                            'bg-gray-500/10 text-gray-400 border-gray-500/20',
                        )}
                      >
                        {wall.exchange}
                      </span>
                      {wall.market && (
                        <span className="block text-[10px] text-textSecondary mt-0.5 capitalize">
                          {wall.market}
                        </span>
                      )}
                    </td>

                    {/* Symbol */}
                    <td className="px-4 py-3 whitespace-nowrap font-semibold">
                      {wall.symbol}
                    </td>

                    {/* Side */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold',
                          isBid
                            ? 'bg-green-500/10 text-[#22c55e]'
                            : 'bg-red-500/10 text-[#ef4444]',
                        )}
                      >
                        {wall.side}
                      </span>
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                      ${formatPrice(wall.price)}
                    </td>

                    {/* Volume USD */}
                    <td className="px-4 py-3 whitespace-nowrap font-semibold">
                      {formatUSD(wall.volumeUSD)}
                    </td>

                    {/* % From Mid */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          'text-xs font-medium',
                          wall.percentFromMid < 0
                            ? 'text-[#22c55e]'
                            : wall.percentFromMid > 0
                              ? 'text-[#ef4444]'
                              : 'text-textSecondary',
                        )}
                      >
                        {wall.percentFromMid != null
                          ? `${wall.percentFromMid >= 0 ? '+' : ''}${Number(wall.percentFromMid).toFixed(2)}%`
                          : '—'}
                      </span>
                    </td>

                    {/* Wall Age */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-textSecondary">
                      <span className="inline-flex items-center gap-1.5">
                        {formatAge(wall.wallAgeMs)}
                        {isFresh && (
                          <span
                            className="relative flex h-1.5 w-1.5"
                            title="Fresh wall (< 2 min)"
                          >
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                          </span>
                        )}
                      </span>
                    </td>

                    {/* Trade Link */}
                    <td className="px-4 py-3 whitespace-nowrap hidden md:table-cell">
                      {tradeUrl && tradeUrl !== '#' ? (
                        <a
                          href={tradeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-accent/80 transition-colors"
                          title={t('Open on {{exchange}}', {
                            exchange: wall.exchange,
                          })}
                        >
                          <ExternalLink size={15} />
                        </a>
                      ) : (
                        <span className="text-textSecondary/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer count */}
      <p className="text-xs text-textSecondary px-1">
        {t('Showing {{count}} walls', { count: sorted.length })}
      </p>
    </div>
  );
};

export default DensityTable;
