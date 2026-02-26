import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarketStore } from '../../store/marketStore';
import { usePrices } from '../../hooks/usePrices';
import MiniChart from '../charts/MiniChart';
import { ArrowUp, ArrowDown, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';
import LoadingSpinner from '../common/LoadingSpinner';

const MarketTable = () => {
  const { coins, loading, fetchCoins } = useMarketStore();
  const { prices } = usePrices();
  const navigate = useNavigate();
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  React.useEffect(() => {
    if (coins.length === 0) {
      fetchCoins();
    }
  }, [coins.length, fetchCoins]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedCoins = useMemo(() => {
    if (!sortConfig.key) return coins;

    return [...coins].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];

      // Handle nested properties
      if (sortConfig.key === 'price_change_percentage_24h') {
        aValue = a.price_change_percentage_24h || 0;
        bValue = b.price_change_percentage_24h || 0;
      } else if (sortConfig.key === 'price_change_percentage_7d') {
        aValue = a.price_change_percentage_7d_in_currency || 0;
        bValue = b.price_change_percentage_7d_in_currency || 0;
      }

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [coins, sortConfig]);

  const paginatedCoins = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedCoins.slice(start, start + itemsPerPage);
  }, [sortedCoins, currentPage]);

  const totalPages = Math.ceil(sortedCoins.length / itemsPerPage);

  const formatPrice = (price) => {
    if (!price) return 'N/A';
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatLargeNumber = (num) => {
    if (!num) return 'N/A';
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    return `$${num.toLocaleString()}`;
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return 'N/A';
    const isPositive = value >= 0;
    return (
      <span className={cn('flex items-center gap-1', isPositive ? 'text-green-400' : 'text-red-400')}>
        {isPositive ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        {Math.abs(value).toFixed(2)}%
      </span>
    );
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) {
      return <ChevronUp className="h-4 w-4 text-gray-500 opacity-0 group-hover:opacity-100" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="h-4 w-4 text-blue-400" />
    ) : (
      <ChevronDown className="h-4 w-4 text-blue-400" />
    );
  };

  const generateSparklineData = (coin) => {
    // Generate mock data for sparkline - in real app, this would come from historical data
    const data = [];
    const basePrice = prices[coin.id] || coin.current_price || 1000;
    for (let i = 0; i < 24; i++) {
      data.push({
        time: Date.now() - (24 - i) * 3600000,
        value: basePrice * (0.95 + Math.random() * 0.1),
      });
    }
    return data;
  };

  if (loading && coins.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surfaceDark border-b border-border">
            <tr>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                onClick={() => handleSort('market_cap_rank')}
              >
                <div className="flex items-center gap-1">
                  Rank
                  <SortIcon columnKey="market_cap_rank" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1">
                  Coin
                  <SortIcon columnKey="name" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                onClick={() => handleSort('current_price')}
              >
                <div className="flex items-center justify-end gap-1">
                  Price
                  <SortIcon columnKey="current_price" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                onClick={() => handleSort('price_change_percentage_24h')}
              >
                <div className="flex items-center justify-end gap-1">
                  24h%
                  <SortIcon columnKey="price_change_percentage_24h" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                onClick={() => handleSort('price_change_percentage_7d')}
              >
                <div className="flex items-center justify-end gap-1">
                  7d%
                  <SortIcon columnKey="price_change_percentage_7d" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                onClick={() => handleSort('market_cap')}
              >
                <div className="flex items-center justify-end gap-1">
                  Market Cap
                  <SortIcon columnKey="market_cap" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
                onClick={() => handleSort('total_volume')}
              >
                <div className="flex items-center justify-end gap-1">
                  24h Volume
                  <SortIcon columnKey="total_volume" />
                </div>
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider">
                Chart
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginatedCoins.map((coin) => (
              <tr
                key={coin.id}
                className="hover:bg-surfaceHover/50 cursor-pointer transition-colors"
                onClick={() => navigate(`/charts?coin=${coin.id}`)}
              >
                <td className="px-4 py-4 whitespace-nowrap text-textSecondary">
                  {coin.market_cap_rank || 'N/A'}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    {coin.image && (
                      <img src={coin.image} alt={coin.name} className="h-8 w-8 rounded-full" />
                    )}
                    <div>
                      <div className="text-textPrimary font-medium">{coin.name}</div>
                      <div className="text-textSecondary text-xs">{coin.symbol.toUpperCase()}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-right text-textPrimary font-medium">
                  {formatPrice(prices[coin.id] || coin.current_price)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-right">
                  {formatPercent(coin.price_change_percentage_24h)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-right">
                  {formatPercent(coin.price_change_percentage_7d_in_currency)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-right text-textSecondary">
                  {formatLargeNumber(coin.market_cap)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-right text-textSecondary">
                  {formatLargeNumber(coin.total_volume)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="w-24 h-10 flex justify-end">
                    <MiniChart data={generateSparklineData(coin)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-4 py-3 bg-surfaceDark border-t border-border flex items-center justify-between">
          <div className="text-sm text-textSecondary">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
            {Math.min(currentPage * itemsPerPage, sortedCoins.length)} of {sortedCoins.length} coins
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 bg-surface border border-border rounded text-textSecondary hover:bg-surfaceHover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 bg-surface border border-border rounded text-textSecondary hover:bg-surfaceHover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketTable;
