import React, { useEffect, useState } from 'react';
import { useMarketStore } from '../../store/marketStore';
import Card from '../common/Card';
import { TrendingUp, DollarSign, BarChart3 } from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';

const MarketOverview = () => {
  const { coins, loading, fetchCoins } = useMarketStore();
  const [marketStats, setMarketStats] = useState({
    totalMarketCap: 0,
    btcDominance: 0,
    totalVolume24h: 0,
  });

  useEffect(() => {
    if (coins.length === 0) {
      fetchCoins();
    }
  }, [coins.length, fetchCoins]);

  useEffect(() => {
    if (coins.length > 0) {
      const btc = coins.find((c) => c.id === 'bitcoin');
      const totalMarketCap = coins.reduce((sum, coin) => sum + (coin.market_cap || 0), 0);
      const totalVolume24h = coins.reduce((sum, coin) => sum + (coin.total_volume || 0), 0);
      const btcMarketCap = btc?.market_cap || 0;
      const btcDominance = totalMarketCap > 0 ? (btcMarketCap / totalMarketCap) * 100 : 0;

      setMarketStats({
        totalMarketCap,
        btcDominance,
        totalVolume24h,
      });
    }
  }, [coins]);

  const formatLargeNumber = (num) => {
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    return `$${num.toLocaleString()}`;
  };

  if (loading && coins.length === 0) {
    return (
      <Card header="Market Overview">
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card header="Market Overview">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surfaceHover rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-textSecondary text-sm">Total Market Cap</span>
            <DollarSign className="h-5 w-5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-textPrimary">
            {formatLargeNumber(marketStats.totalMarketCap)}
          </div>
        </div>

        <div className="bg-surfaceHover rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-textSecondary text-sm">BTC Dominance</span>
            <TrendingUp className="h-5 w-5 text-orange-400" />
          </div>
          <div className="text-xl font-bold text-textPrimary">
            {marketStats.btcDominance.toFixed(2)}%
          </div>
        </div>

        <div className="bg-surfaceHover rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-textSecondary text-sm">24h Volume</span>
            <BarChart3 className="h-5 w-5 text-green-400" />
          </div>
          <div className="text-xl font-bold text-textPrimary">
            {formatLargeNumber(marketStats.totalVolume24h)}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default MarketOverview;
