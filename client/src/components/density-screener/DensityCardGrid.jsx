import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDensityScreenerStore } from '../../store/densityScreenerStore';
import { cn } from '../../utils/cn';
import { Download, ExternalLink, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCHANGE_BADGE = {
  binance: { abbr: 'BIN', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  bybit:   { abbr: 'BYB', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  okx:     { abbr: 'OKX', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
};

const MARKET_ABBR = { futures: 'F', spot: 'S' };

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPrice(price) {
  if (price == null) return '—';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return price.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

function formatUSD(value) {
  if (value == null) return '—';
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatAge(ms) {
  if (ms == null || ms < 0) return '';
  if (ms < 60000) return '<1m';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h${rem}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatLastUpdated(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  } catch { return ''; }
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
    default: return '#';
  }
}

// ---------------------------------------------------------------------------
// WallRow — a single wall inside a card
// ---------------------------------------------------------------------------

function WallRow({ wall }) {
  const isBid = wall.side === 'BID';
  const badge = EXCHANGE_BADGE[wall.exchange] || { abbr: wall.exchange?.slice(0, 3).toUpperCase(), color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
  const marketLabel = MARKET_ABBR[wall.market] || '';
  const tradeUrl = getTradeLink(wall);
  const isFresh = wall.wallAgeMs != null && wall.wallAgeMs < 120000;
  const pct = wall.percentFromMid;

  return (
    <div className={cn(
      'flex items-center gap-1 px-1.5 py-[3px] text-[11px] leading-tight rounded transition-colors hover:bg-surfaceHover/50',
      isBid ? 'border-l-2 border-l-green-500/60' : 'border-l-2 border-l-red-500/60',
    )}>
      {/* Exchange + market badge */}
      <span className={cn('px-1 py-px rounded text-[8px] font-bold border shrink-0 uppercase leading-none', badge.color)}>
        {badge.abbr} {marketLabel}
      </span>

      {/* Price */}
      <span className="font-mono text-textSecondary shrink-0 text-[10px]">${formatPrice(wall.price)}</span>

      {/* % from mid */}
      {pct != null && (
        <span className={cn(
          'text-[9px] shrink-0',
          Math.abs(pct) <= 1 ? 'text-green-400' : Math.abs(pct) <= 3 ? 'text-yellow-400' : 'text-textSecondary/50',
        )}>
          {Math.abs(pct).toFixed(1)}%
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Volume */}
      <span className={cn(
        'font-semibold shrink-0 text-[11px]',
        wall.volumeUSD >= 5_000_000 ? 'text-yellow-400' :
        wall.volumeUSD >= 1_000_000 ? 'text-textPrimary' : 'text-textSecondary',
      )}>
        {formatUSD(wall.volumeUSD)}
      </span>

      {/* Age */}
      <span className="text-textSecondary/50 shrink-0 text-[9px] w-7 text-right">
        {formatAge(wall.wallAgeMs)}
        {isFresh && (
          <span className="inline-block ml-px w-1 h-1 rounded-full bg-green-500 align-middle" />
        )}
      </span>

      {/* Trade link */}
      {tradeUrl && tradeUrl !== '#' && (
        <a
          href={tradeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent/40 hover:text-accent transition-colors shrink-0 hidden sm:inline"
          title={`Open on ${wall.exchange}`}
        >
          <ExternalLink size={9} />
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenCard — one card per symbol
// ---------------------------------------------------------------------------

function TokenCard({ symbol, walls, totalVolume }) {
  // Sort walls inside the card: bids first (desc by volume), then asks (desc by volume)
  const sortedWalls = useMemo(() => {
    const bids = walls.filter(w => w.side === 'BID').sort((a, b) => b.volumeUSD - a.volumeUSD);
    const asks = walls.filter(w => w.side === 'ASK').sort((a, b) => b.volumeUSD - a.volumeUSD);
    return [...asks, ...bids];
  }, [walls]);

  const baseSymbol = symbol.replace(/USDT$/i, '');

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-surfaceHover/40 border-b border-border">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-bold text-textPrimary truncate">{baseSymbol}</span>
          <span className="text-[9px] text-textSecondary">{walls.length}</span>
        </div>
        <span className="text-[11px] font-semibold text-accent shrink-0">{formatUSD(totalVolume)}</span>
      </div>

      {/* Walls list */}
      <div className="flex-1 flex flex-col gap-0 p-0.5">
        {sortedWalls.map((wall, i) => (
          <WallRow
            key={`${wall.exchange}-${wall.market}-${wall.side}-${wall.price}-${i}`}
            wall={wall}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function SkeletonCards({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-surface border border-border rounded-lg animate-pulse">
          <div className="px-2.5 py-1.5 bg-surfaceHover/40 border-b border-border">
            <div className="h-4 bg-surfaceHover rounded w-1/3" />
          </div>
          <div className="p-2 space-y-1.5">
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="h-5 bg-surfaceHover rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DensityCardGrid component
// ---------------------------------------------------------------------------

const DensityCardGrid = () => {
  const { t } = useTranslation();
  const {
    walls,
    loading,
    lastUpdated,
    isFetching,
    exportCSV,
  } = useDensityScreenerStore();

  // Group walls by symbol, compute totals, sort groups by total volume desc
  const groups = useMemo(() => {
    if (!walls?.length) return [];

    const map = new Map();
    for (const wall of walls) {
      const key = wall.symbol;
      if (!map.has(key)) map.set(key, { symbol: key, walls: [], totalVolume: 0 });
      const group = map.get(key);
      group.walls.push(wall);
      group.totalVolume += wall.volumeUSD || 0;
    }

    return Array.from(map.values()).sort((a, b) => b.totalVolume - a.totalVolume);
  }, [walls]);

  // ── Loading state ─────────────────────────────────────────
  if (loading && walls.length === 0) {
    return <SkeletonCards />;
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

  // ── Card Grid ─────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-textSecondary">
          <span className="font-medium text-textPrimary">
            {walls.length} {t('walls')} · {groups.length} {t('tokens')}
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

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
        {groups.map((group) => (
          <TokenCard
            key={group.symbol}
            symbol={group.symbol}
            walls={group.walls}
            totalVolume={group.totalVolume}
          />
        ))}
      </div>

      {/* Footer */}
      <p className="text-xs text-textSecondary px-1">
        {t('Showing {{count}} walls across {{tokens}} tokens', { count: walls.length, tokens: groups.length })}
      </p>
    </div>
  );
};

export default DensityCardGrid;
