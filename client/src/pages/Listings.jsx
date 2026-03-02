import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown } from 'lucide-react';
import Card from '../components/common/Card';
import { API_BASE_URL } from '../utils/constants';
import usePageTitle from '../hooks/usePageTitle';

const DEFAULT_SOURCES = [
  { exchange: 'Binance', count: 0 },
  { exchange: 'Bybit', count: 0 },
  { exchange: 'OKX', count: 0 },
  { exchange: 'MEXC', count: 0 },
  { exchange: 'Bitget', count: 0 },
  { exchange: 'Gate.io', count: 0 },
];

const Listings = () => {
  usePageTitle('Listings');
  const { t } = useTranslation();
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState(DEFAULT_SOURCES);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

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
    return [...items].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, sortConfig]);

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
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          {sources.map((source) => (
            <span
              key={source.exchange}
              className="inline-flex items-center rounded-full border border-border bg-surfaceDark px-2.5 py-1 text-xs text-textSecondary"
            >
              <span className="font-medium text-textPrimary">{source.exchange}</span>
              <span className="ml-1.5 text-blue-400">{source.count}</span>
            </span>
          ))}
          <span className="ml-auto text-xs text-textSecondary">
            {refreshing ? t('Refreshing…') : (lastUpdatedAt ? `${t('Updated')}: ${new Date(lastUpdatedAt).toLocaleString()}` : t('Waiting for first sync…'))}
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
                    {t('No upcoming listings found. Data is refreshed every 5 minutes.')}
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
                        {t('UPCOMING')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-textPrimary">{row.date}</td>
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
