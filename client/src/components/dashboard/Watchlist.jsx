import React, { useEffect, useState } from 'react';
import { useMarketStore } from '../../store/marketStore';
import { usePrices } from '../../hooks/usePrices';
import { watchlistService } from '../../services/watchlistService';
import MiniChart from '../charts/MiniChart';
import Card from '../common/Card';
import Button from '../common/Button';
import { X, Plus } from 'lucide-react';
import { cn } from '../../utils/cn';
import LoadingSpinner from '../common/LoadingSpinner';
import CoinSelector from '../charts/CoinSelector';

const Watchlist = () => {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState('');
  const { coins, fetchCoins } = useMarketStore();
  const { prices } = usePrices();

  useEffect(() => {
    fetchWatchlist();
    if (coins.length === 0) {
      fetchCoins();
    }
  }, [fetchCoins]);

  const fetchWatchlist = async () => {
    try {
      setLoading(true);
      const data = await watchlistService.getWatchlist();
      setWatchlist(data.watchlist || []);
    } catch (error) {
      console.error('Failed to fetch watchlist:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCoin = async () => {
    if (!selectedCoin) return;
    
    const coin = coins.find((c) => c.id === selectedCoin);
    if (!coin) return;

    try {
      await watchlistService.addToWatchlist(coin.id, coin.symbol);
      await fetchWatchlist();
      setShowAddModal(false);
      setSelectedCoin('');
    } catch (error) {
      console.error('Failed to add coin:', error);
    }
  };

  const handleRemoveCoin = async (coinId) => {
    try {
      await watchlistService.removeFromWatchlist(coinId);
      await fetchWatchlist();
    } catch (error) {
      console.error('Failed to remove coin:', error);
    }
  };

  const getWatchlistCoins = () => {
    return watchlist.map((item) => {
      const coin = coins.find((c) => c.id === item.coinId);
      return {
        ...item,
        coin: coin,
        currentPrice: prices[item.coinId] || coin?.current_price || 0,
        priceChange24h: coin?.price_change_percentage_24h || 0,
      };
    });
  };

  const generateSparklineData = (coinId) => {
    const basePrice = prices[coinId] || 0;
    const data = [];
    for (let i = 0; i < 24; i++) {
      data.push({
        time: Date.now() - (24 - i) * 3600000,
        value: basePrice * (0.95 + Math.random() * 0.1),
      });
    }
    return data;
  };

  if (loading) {
    return (
      <Card header="Watchlist">
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  const watchlistCoins = getWatchlistCoins();

  return (
    <>
      <Card
        header={
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-textPrimary">Watchlist</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddModal(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Coin
            </Button>
          </div>
        }
      >
        {watchlistCoins.length === 0 ? (
          <div className="text-center py-8 text-textSecondary">
            <p>No coins in watchlist</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setShowAddModal(true)}
            >
              Add Your First Coin
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {watchlistCoins.map((item) => (
              <div
                key={item.coinId}
                className="flex items-center justify-between p-3 bg-surfaceHover rounded-lg hover:bg-surfaceHover/70 transition-colors"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {item.coin?.image && (
                    <img
                      src={item.coin.image}
                      alt={item.coin.name}
                      className="h-10 w-10 rounded-full"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-textPrimary font-medium truncate">
                      {item.coin?.name || item.coinSymbol}
                    </div>
                    <div className="text-sm text-textSecondary">
                      {item.coinSymbol?.toUpperCase()}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-textPrimary font-medium">
                        ${item.currentPrice.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                      <div
                        className={cn(
                          'text-xs',
                          item.priceChange24h >= 0
                            ? 'text-success'
                            : 'text-danger'
                        )}
                      >
                        {item.priceChange24h >= 0 ? '+' : ''}
                        {item.priceChange24h.toFixed(2)}%
                      </div>
                    </div>
                    <div className="w-20 h-10">
                      <MiniChart data={generateSparklineData(item.coinId)} />
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveCoin(item.coinId)}
                  className="ml-4 p-1 text-textSecondary hover:text-danger transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface border border-border rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-textPrimary mb-4">
              Add Coin to Watchlist
            </h3>
            <CoinSelector
              value={selectedCoin}
              onChange={setSelectedCoin}
              className="mb-4"
            />
            <div className="flex gap-3">
              <Button
                variant="primary"
                onClick={handleAddCoin}
                disabled={!selectedCoin}
                className="flex-1"
              >
                Add
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedCoin('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Watchlist;
