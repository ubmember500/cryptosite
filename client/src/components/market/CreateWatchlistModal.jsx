import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

const CreateWatchlistModal = ({ isOpen, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [watchlistName, setWatchlistName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (watchlistName.trim()) {
      onSubmit(watchlistName.trim());
      setWatchlistName('');
    }
  };

  const handleClose = () => {
    setWatchlistName('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-textPrimary">
            {t('Create new watchlist')}
          </h2>
          <button
            onClick={handleClose}
            className="text-textSecondary hover:text-textPrimary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={watchlistName}
            onChange={(e) => setWatchlistName(e.target.value)}
            placeholder={t('Enter watchlist name')}
            className="w-full bg-background border border-border rounded-lg px-4 py-3 text-textPrimary placeholder-textSecondary focus:outline-none focus:ring-2 focus:ring-accent mb-4"
            autoFocus
          />

          <button
            type="submit"
            disabled={!watchlistName.trim()}
            className="w-full bg-accent hover:bg-accentHover text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('Create watchlist')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CreateWatchlistModal;
