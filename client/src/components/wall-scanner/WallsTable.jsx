import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWallScannerStore } from '../../store/wallScannerStore';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { cn } from '../../utils/cn';
import { ArrowUpDown, ArrowUp, ArrowDown, Download, ExternalLink } from 'lucide-react';

const EXCHANGE_LINKS = {
  binance: (sym) => `https://www.binance.com/en/futures/${sym.replace('/', '')}`,
  bybit: (sym) => `https://www.bybit.com/trade/usdt/${sym.replace('/', '')}`,
  okx: (sym) => {
    const [base, quote] = sym.split('/');
    return `https://www.okx.com/trade-futures/${base.toLowerCase()}-${quote.toLowerCase()}-swap`;
  },
  gate: (sym) => {
    const [base, quote] = sym.split('/');
    return `https://www.gate.io/futures_trade/USDT/${base}_${quote}`;
  },
  bitget: (sym) => `https://www.bitget.com/futures/usdt/${sym.replace('/', '')}`,
  mexc: (sym) => {
    const [base, quote] = sym.split('/');
    return `https://futures.mexc.com/exchange/${base}_${quote}`;
  },
};

const EXCHANGE_COLORS = {
  binance: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  bybit: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  okx: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  gate: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  bitget: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  mexc: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const COLUMNS = [
  { key: 'timestamp', label: 'Time', sortable: true },
  { key: 'exchange', label: 'Exchange', sortable: true },
  { key: 'symbol', label: 'Symbol', sortable: true },
  { key: 'side', label: 'Side', sortable: true },
  { key: 'price', label: 'Price', sortable: true },
  { key: 'volumeUSD', label: 'Volume USD', sortable: true },
  { key: 'percentFromMid', label: '% from Mid', sortable: true },
  { key: 'volume', label: 'Volume', sortable: true },
  { key: 'link', label: 'Link', sortable: false },
];

const formatPrice = (val) => {
  if (val == null) return '—';
  const num = Number(val);
  if (num >= 1) return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
};

const formatUSD = (val) => {
  if (val == null) return '—';
  const num = Number(val);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toLocaleString()}`;
};

const formatVolume = (val, symbol) => {
  if (val == null) return '—';
  const coin = symbol ? symbol.split('/')[0] : '';
  const formatted = Number(val).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return coin ? `${formatted} ${coin}` : formatted;
};

const formatTime = (val) => {
  if (!val) return '—';
  try {
    const d = new Date(val);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return val;
  }
};

const WallsTable = () => {
  const { t } = useTranslation();
  const { walls, exportCSV } = useWallScannerStore();

  const [sortKey, setSortKey] = useState('volumeUSD');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (key) => {
    if (!COLUMNS.find((c) => c.key === key)?.sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filtered = useMemo(() => {
    let data = [...walls];
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

  const getSortIcon = (key) => {
    if (sortKey !== key) return <ArrowUpDown size={14} className="text-textSecondary/50" />;
    return sortDir === 'asc' ? (
      <ArrowUp size={14} className="text-accent" />
    ) : (
      <ArrowDown size={14} className="text-accent" />
    );
  };

  const getTradeLink = (exchange, symbol) => {
    const fn = EXCHANGE_LINKS[exchange?.toLowerCase()];
    return fn ? fn(symbol) : null;
  };

  if (walls.length === 0) {
    return <div className="h-64 bg-surface rounded-xl border border-border" />;
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: Export CSV */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div />

        {/* Export CSV */}
        <Button
          variant="outline"
          size="sm"
          onClick={exportCSV}
          className="flex items-center gap-2"
        >
          <Download size={15} />
          {t('Export CSV')}
        </Button>
      </div>

      {/* Table */}
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
                        'cursor-pointer hover:text-textPrimary transition-colors select-none'
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
              {filtered.map((wall, i) => {
                const isBid = wall.side === 'BID';
                const tradeUrl = getTradeLink(wall.exchange, wall.symbol);
                const exKey = wall.exchange?.toLowerCase();
                const isEven = i % 2 === 0;

                return (
                  <tr
                    key={`${wall.exchange}-${wall.symbol}-${wall.price}-${i}`}
                    className={cn(
                      'border-b border-border transition-colors',
                      isBid ? 'border-l-2 border-l-green-500/60' : 'border-l-2 border-l-blue-500/60',
                      isEven ? 'bg-surface' : 'bg-surfaceHover/30',
                      'hover:bg-surfaceHover/60'
                    )}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-textSecondary text-xs font-mono">
                      {formatTime(wall.timestamp)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase border',
                          EXCHANGE_COLORS[exKey] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                        )}
                      >
                        {wall.exchange}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium">
                      {wall.symbol}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={isBid ? 'success' : 'active'}>
                        {wall.side}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                      {formatPrice(wall.price)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold">
                      {formatUSD(wall.volumeUSD)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          'text-xs font-medium',
                          isBid ? 'text-green-400' : 'text-blue-400'
                        )}
                      >
                        {wall.percentFromMid != null
                          ? `${wall.percentFromMid >= 0 ? '+' : ''}${Number(wall.percentFromMid).toFixed(2)}%`
                          : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-textSecondary">
                      {formatVolume(wall.volume, wall.symbol)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {tradeUrl ? (
                        <a
                          href={tradeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-accent/80 transition-colors"
                          title={t('Open on {{exchange}}', { exchange: wall.exchange })}
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

      {/* Result count */}
      <p className="text-xs text-textSecondary px-1">
        {t('Showing {{count}} walls', { count: filtered.length })}
      </p>
    </div>
  );
};

export default WallsTable;
