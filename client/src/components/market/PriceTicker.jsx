import React, { useEffect, useState } from 'react';
import { useMarketStore } from '../../store/marketStore';
import { usePrices } from '../../hooks/usePrices';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../../utils/cn';

const PriceTicker = () => {
  const { coins, fetchCoins } = useMarketStore();
  const { prices } = usePrices();
  const [tickerCoins, setTickerCoins] = useState([]);

  useEffect(() => {
    if (coins.length === 0) {
      fetchCoins();
    }
  }, [coins.length, fetchCoins]);

  useEffect(() => {
    // Get popular coins: BTC, ETH, SOL, and a few more
    const popularIds = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano', 'dogecoin', 'polkadot', 'avalanche-2'];
    const popularCoins = coins
      .filter((coin) => popularIds.includes(coin.id))
      .sort((a, b) => popularIds.indexOf(a.id) - popularIds.indexOf(b.id))
      .slice(0, 8); // Show top 8

    setTickerCoins(popularCoins);
  }, [coins]);

  const formatPrice = (price) => {
    if (!price) return 'N/A';
    if (price >= 1000) {
      return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(4)}`;
  };

  const getPriceChange = (coin) => {
    const currentPrice = prices[coin.id] || coin.current_price;
    const change24h = coin.price_change_percentage_24h || 0;
    return { currentPrice, change24h };
  };

  return (
    <div className="bg-gray-900 border-b border-gray-700 overflow-hidden">
      <div className="flex animate-ticker-scroll">
        <div className="flex gap-8 px-6 py-3">
          {tickerCoins.map((coin) => {
            const { currentPrice, change24h } = getPriceChange(coin);
            const isPositive = change24h >= 0;

            return (
              <div
                key={coin.id}
                className="flex items-center gap-2 whitespace-nowrap"
              >
                <span className="text-gray-400 font-medium">{coin.symbol.toUpperCase()}</span>
                <span className="text-gray-200 font-semibold">
                  {formatPrice(currentPrice)}
                </span>
                <span
                  className={cn(
                    'flex items-center gap-1 text-xs font-medium',
                    isPositive ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {isPositive ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {Math.abs(change24h).toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
        {/* Duplicate for seamless loop */}
        <div className="flex gap-8 px-6 py-3">
          {tickerCoins.map((coin) => {
            const { currentPrice, change24h } = getPriceChange(coin);
            const isPositive = change24h >= 0;

            return (
              <div
                key={`${coin.id}-dup`}
                className="flex items-center gap-2 whitespace-nowrap"
              >
                <span className="text-gray-400 font-medium">{coin.symbol.toUpperCase()}</span>
                <span className="text-gray-200 font-semibold">
                  {formatPrice(currentPrice)}
                </span>
                <span
                  className={cn(
                    'flex items-center gap-1 text-xs font-medium',
                    isPositive ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {isPositive ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {Math.abs(change24h).toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PriceTicker;
