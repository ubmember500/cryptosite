import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { useMarketStore } from '../../store/marketStore';
import { cn } from '../../utils/cn';

const CoinSelector = ({ value, onChange, className, placeholder = 'Select a coin' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);
  const coins = useMarketStore((state) => state.coins);
  const fetchCoins = useMarketStore((state) => state.fetchCoins);

  useEffect(() => {
    if (coins.length === 0) {
      fetchCoins();
    }
  }, [coins.length, fetchCoins]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCoin = coins.find((coin) => coin.id === value);

  const filteredCoins = coins.filter((coin) => {
    const query = searchQuery.toLowerCase();
    return (
      coin.name.toLowerCase().includes(query) ||
      coin.symbol.toLowerCase().includes(query) ||
      coin.id.toLowerCase().includes(query)
    );
  });

  const handleSelect = (coin) => {
    onChange(coin.id);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className={cn('relative w-full', className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2',
          'flex items-center justify-between text-left',
          'hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500',
          'transition-colors'
        )}
      >
        <span className={cn('text-gray-300', !selectedCoin && 'text-gray-500')}>
          {selectedCoin
            ? `${selectedCoin.name} (${selectedCoin.symbol.toUpperCase()})`
            : placeholder}
        </span>
        <ChevronDown className="h-5 w-5 text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search coins..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md pl-10 pr-3 py-2 text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredCoins.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">No coins found</div>
            ) : (
              <div className="py-1">
                {filteredCoins.map((coin) => (
                  <button
                    key={coin.id}
                    type="button"
                    onClick={() => handleSelect(coin)}
                    className={cn(
                      'w-full px-4 py-2 text-left hover:bg-gray-700 transition-colors',
                      'flex items-center justify-between',
                      value === coin.id && 'bg-gray-700'
                    )}
                  >
                    <div className="flex flex-col">
                      <span className="text-gray-200 font-medium">{coin.name}</span>
                      <span className="text-gray-400 text-sm">{coin.symbol.toUpperCase()}</span>
                    </div>
                    {coin.current_price && (
                      <span className="text-gray-300 text-sm">
                        ${coin.current_price.toLocaleString()}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CoinSelector;
