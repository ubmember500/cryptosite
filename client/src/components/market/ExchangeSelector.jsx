import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMarketStore } from '../../store/marketStore';
import { ChevronDown, Trash2 } from 'lucide-react';
import DeleteWatchlistModal from './DeleteWatchlistModal';

const MARKET_OPTIONS = [
  { value: 'binance_futures', exchange: 'binance', exchangeType: 'futures' },
  { value: 'binance_spot', exchange: 'binance', exchangeType: 'spot' },
  { value: 'bybit_futures', exchange: 'bybit', exchangeType: 'futures' },
  { value: 'bybit_spot', exchange: 'bybit', exchangeType: 'spot' },
  { value: 'okx_futures', exchange: 'okx', exchangeType: 'futures' },
  { value: 'okx_spot', exchange: 'okx', exchangeType: 'spot' },
  { value: 'gate_futures', exchange: 'gate', exchangeType: 'futures' },
  { value: 'gate_spot', exchange: 'gate', exchangeType: 'spot' },
  { value: 'bitget_futures', exchange: 'bitget', exchangeType: 'futures' },
  { value: 'bitget_spot', exchange: 'bitget', exchangeType: 'spot' },
  { value: 'mexc_futures', exchange: 'mexc', exchangeType: 'futures' },
  { value: 'mexc_spot', exchange: 'mexc', exchangeType: 'spot' },
];

const ExchangeSelector = () => {
  const { t } = useTranslation();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  const { 
    exchange, 
    exchangeType, 
    setExchange, 
    setExchangeType, 
    watchlists,
    selectedWatchlist,
    selectWatchlist,
    setExchangeOrWatchlist,
    deleteWatchlist
  } = useMarketStore();

  // Determine current value - watchlist ID or exchange_type
  const currentValue = selectedWatchlist || `${exchange}_${exchangeType}`;
  
  // Get current watchlist name for delete confirmation
  const currentWatchlist = watchlists.find(w => w.id === selectedWatchlist);

  const handleDeleteClick = () => {
    if (selectedWatchlist) {
      setIsDeleteModalOpen(true);
    }
  };

  const handleConfirmDelete = () => {
    if (selectedWatchlist) {
      deleteWatchlist(selectedWatchlist);
      // Switch to default exchange after deletion
      setExchange('binance');
      setExchangeType('futures');
    }
    setIsDeleteModalOpen(false);
  };

  const handleChange = (e) => {
    const value = e.target.value;
    
    // Handle "New Watchlist" option
    if (value === 'new_watchlist') {
      // Open the watchlist modal
      if (window.openWatchlistModal) {
        window.openWatchlistModal();
      }
      // Reset to current value to avoid visual change
      e.target.value = currentValue;
      return;
    }
    
    // Handle "Delete Watchlist" option
    if (value === 'delete_watchlist') {
      handleDeleteClick();
      // Reset to current value to avoid visual change
      e.target.value = currentValue;
      return;
    }
    
    // Handle watchlist selection
    if (value.startsWith('watchlist_')) {
      selectWatchlist(value);
      setExchangeOrWatchlist(value);
      return;
    }
    
    // Handle exchange selection
    const option = MARKET_OPTIONS.find((o) => o.value === value);
    if (!option) return;
    setExchange(option.exchange);
    setExchangeType(option.exchangeType);
    setExchangeOrWatchlist(value);
  };

  return (
    <>
      <DeleteWatchlistModal
        isOpen={isDeleteModalOpen}
        watchlistName={currentWatchlist?.name}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
      />
      
      <div className="relative">
        <select
        value={currentValue}
        onChange={handleChange}
        className="appearance-none bg-surface border border-border rounded-lg px-4 py-2 pr-8 text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer min-w-[180px]"
      >
        <option value="new_watchlist" className="font-semibold">➕ {t('New Watchlist')}</option>
        
        {/* Show delete button if a watchlist is selected */}
        {selectedWatchlist && (
          <option value="delete_watchlist" className="font-semibold text-danger">🗑️ {t('Delete watchlist')}</option>
        )}
        
        {/* Show watchlists if any exist */}
        {watchlists.length > 0 && (
          <>
            <option disabled>──────────────</option>
            {watchlists.map((watchlist) => (
              <option key={watchlist.id} value={watchlist.id}>
                📋 {watchlist.name}
              </option>
            ))}
          </>
        )}
        
        <option disabled>──────────────</option>
        <option value="binance_futures">{t('Binance. Futures')}</option>
        <option value="binance_spot">{t('Binance. Spot')}</option>
        <option value="bybit_futures">{t('Bybit. Futures')}</option>
        <option value="bybit_spot">{t('Bybit. Spot')}</option>
        <option value="okx_futures">{t('OKX. Futures')}</option>
        <option value="okx_spot">{t('OKX. Spot')}</option>
        <option value="gate_futures">{t('Gate.io Futures')}</option>
        <option value="gate_spot">{t('Gate.io Spot')}</option>
        <option value="bitget_futures">{t('Bitget Futures')}</option>
        <option value="bitget_spot">{t('Bitget Spot')}</option>
        <option value="mexc_futures">{t('MEXC Futures')}</option>
        <option value="mexc_spot">{t('MEXC Spot')}</option>
      </select>
      <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-textSecondary pointer-events-none" />
    </div>
    </>
  );
};

export default ExchangeSelector;
