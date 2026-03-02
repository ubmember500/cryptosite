import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown } from 'lucide-react';
import Card from '../components/common/Card';
import { API_BASE_URL } from '../utils/constants';
import usePageTitle from '../hooks/usePageTitle';

const ALL_EXCHANGES = ['Binance', 'Bybit', 'OKX', 'MEXC', 'Bitget', 'Gate.io'];

const DEFAULT_SOURCES = ALL_EXCHANGES.map((exchange) => ({ exchange, count: 0 }));

const EXCHANGE_SYMBOLS = {
  Binance: 'BN',
  Bybit: 'BY',
  OKX: 'OK',
  MEXC: 'MX',
  Bitget: 'BG',
  'Gate.io': 'GT',
};

// Exchange brand colours for toggle buttons
const EXCHANGE_COLORS = {
  Binance:  { on: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',  dot: 'bg-yellow-400' },
  Bybit:    { on: 'bg-orange-500/20 border-orange-500/50 text-orange-400', dot: 'bg-orange-400' },
  OKX:      { on: 'bg-blue-500/20   border-blue-500/50   text-blue-400',   dot: 'bg-blue-400'   },
  MEXC:     { on: 'bg-cyan-500/20   border-cyan-500/50   text-cyan-400',   dot: 'bg-cyan-400'   },
  Bitget:   { on: 'bg-teal-500/20   border-teal-500/50   text-teal-400',   dot: 'bg-teal-400'   },
  'Gate.io':{ on: 'bg-red-500/20    border-red-500/50    text-red-400',    dot: 'bg-red-400'    },
};

const Listings = () => {
  usePageTitle('Listings');
  const { t } = useTranslation();
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'asc' });
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState(DEFAULT_SOURCES);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // exchange toggles: Set of currently-enabled exchange names
  const [enabledExchanges, setEnabledExchanges] = useState(() => new Set(ALL_EXCHANGES));

  const toggleExchange = useCallback((exchange) => {
    setEnabledExchanges((prev) => {
      const next = new Set(prev);
      if (next.has(exchange)) {
        // don't allow deselecting all
        if (next.size > 1) next.delete(exchange);
      } else {
        next.add(exchange);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min max
    setRefreshing(true);
    setError(null);
    fetch(`${API_BASE_URL}/market/listings`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('Listings API not found. Restart the server (npm run dev in project root) and try again.');
          }
          throw new Error(res.statusText || 'Failed to load listings');
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data.listings) {
          setItems(
            data.listings.map((row, i) => ({
              ...row,
              market: row.market || row.type || '-',
              id: `${row.exchange}-${row.market || row.type || '-'}-${row.coin}-${i}`,
            }))
          );
          const sourceRows = Array.isArray(data?.meta?.sources) && data.meta.sources.length > 0
            ? data.meta.sources
            : DEFAULT_SOURCES;
          setSources(sourceRows);
          setLastUpdatedAt(data?.meta?.lastUpdatedAt || null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err.name === 'AbortError' ? 'Request took too long.' : (err.message || 'Failed to load listings. Is the server running?');
          setError(msg);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedItems = useMemo(() => {
    const filtered = items.filter((r) => enabledExchanges.has(r.exchange));
    return [...filtered].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, sortConfig, enabledExchanges]);

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) {
      return (
        <span className="inline-flex flex-col -space-y-1.5 opacity-50 group-hover:opacity-100">
          <ChevronUp className="h-3.5 w-3.5 text-current" />
          <ChevronDown className="h-3.5 w-3.5 text-current" />
        </span>
      );
    }
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="h-4 w-4 text-blue-400" />
    ) : (
      <ChevronDown className="h-4 w-4 text-blue-400" />
    );
  };

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-textPrimary">{t('Listings')}</h1>
        <Card className="p-6 text-center text-red-400">{error}</Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-textPrimary">{t('Listings')}</h1>

      {/* Exchange toggle buttons */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          {sources.map((source) => {
            const isOn = enabledExchanges.has(source.exchange);
            const colors = EXCHANGE_COLORS[source.exchange] || EXCHANGE_COLORS['Binance'];
            return (
              <button
                key={source.exchange}
                onClick={() => toggleExchange(source.exchange)}
                title={isOn ? `Hide ${source.exchange}` : `Show ${source.exchange}`}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-all select-none ${
                  isOn
                    ? colors.on
                    : 'bg-transparent border-border text-textSecondary opacity-40 hover:opacity-60'
                }`}
              >
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${isOn ? 'bg-black/25 text-white' : 'bg-surfaceDark text-textSecondary'}`}>
                  {EXCHANGE_SYMBOLS[source.exchange] || source.exchange.slice(0, 2).toUpperCase()}
                </span>
                <span>{source.exchange}</span>
                <span className={`ml-0.5 ${isOn ? 'opacity-80' : 'opacity-50'}`}>{source.count}</span>
                <span className={`ml-1 text-[10px] tracking-wide ${isOn ? 'opacity-80' : 'opacity-60'}`}>{isOn ? 'ON' : 'OFF'}</span>
              </button>
            );
          })}
          <span className="ml-auto text-xs text-textSecondary">
            {refreshing
              ? t('Refreshing\u2026')
              : lastUpdatedAt
              ? `${t('Updated')}: ${new Date(lastUpdatedAt).toLocaleString()}`
              : t('Waiting for first sync\u2026')}
          </span>
        </div>
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surfaceDark">
              <tr>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                  onClick={() => handleSort('coin')}
                >
                  <div className="flex items-center gap-1">
                    {t('Coin / Contract')}
                    <SortIcon columnKey="coin" />
                  </div>
                </th>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                  onClick={() => handleSort('exchange')}
                >
                  <div className="flex items-center gap-1">
                    {t('Exchange')}
                    <SortIcon columnKey="exchange" />
                  </div>
                </th>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                  onClick={() => handleSort('market')}
                >
                  <div className="flex items-center gap-1">
                    {t('Type')}
                    <SortIcon columnKey="market" />
                  </div>
                </th>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider"
                >
                  {t('Status')}
                </th>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                  onClick={() => handleSort('date')}
                >
                  <div className="flex items-center gap-1">
                    {t('Date')}
                    <SortIcon columnKey="date" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-textSecondary">
                    {t('No future listings found. Data refreshes every 5 minutes.')}
                  </td>
                </tr>
              ) : (
                sortedItems.map((row) => (
                  <tr key={row.id} className="hover:bg-surfaceHover/50">
                    <td className="px-4 py-3 text-sm font-medium text-textPrimary">{row.coin}</td>
                    <td className="px-4 py-3 text-sm text-textPrimary">{row.exchange}</td>
                    <td className="px-4 py-3 text-sm text-textPrimary capitalize">{row.market}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        UPCOMING
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-textPrimary font-mono whitespace-nowrap">{row.date}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default Listings;
