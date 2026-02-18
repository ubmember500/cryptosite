import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown } from 'lucide-react';
import Card from '../components/common/Card';
import { API_BASE_URL } from '../utils/constants';

const Listings = () => {
  const { t } = useTranslation();
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min max
    setLoading(true);
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
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err.name === 'AbortError' ? 'Request took too long. Try again (next load will use cache).' : (err.message || 'Failed to load listings. Is the server running?');
          setError(msg);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
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

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-textPrimary">{t('Listings')}</h1>
        <Card className="p-8 text-center">
          <p className="text-textSecondary">{t('Loading...')}</p>
          <p className="mt-2 text-sm text-textSecondary/80">{t('First load can take 30–60 seconds. Later loads use cache.')}</p>
        </Card>
      </div>
    );
  }

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
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-gray-800/80">
              <tr>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:text-white group"
                  onClick={() => handleSort('coin')}
                >
                  <div className="flex items-center gap-1">
                    {t('Coin / Contract')}
                    <SortIcon columnKey="coin" />
                  </div>
                </th>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:text-white group"
                  onClick={() => handleSort('exchange')}
                >
                  <div className="flex items-center gap-1">
                    {t('Exchange')}
                    <SortIcon columnKey="exchange" />
                  </div>
                </th>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:text-white group"
                  onClick={() => handleSort('market')}
                >
                  <div className="flex items-center gap-1">
                    {t('Market')}
                    <SortIcon columnKey="market" />
                  </div>
                </th>
                <th
                  role="columnheader"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:text-white group"
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
                  <td colSpan={4} className="px-4 py-8 text-center text-textSecondary">
                    {t('No upcoming futures listings right now.')}
                  </td>
                </tr>
              ) : (
                sortedItems.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-800/40">
                    <td className="px-4 py-3 text-sm text-textPrimary">{row.coin}</td>
                    <td className="px-4 py-3 text-sm text-textPrimary">{row.exchange}</td>
                    <td className="px-4 py-3 text-sm text-textPrimary capitalize">{row.market}</td>
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
