import React from 'react';
import { useTranslation } from 'react-i18next';

const DeleteWatchlistModal = ({ isOpen, watchlistName, onConfirm, onCancel }) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onCancel}
      />
      
      {/* Modal */}
      <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        {/* Content */}
        <div className="text-center mb-6">
          <p className="text-lg font-semibold text-textPrimary mb-2">
            {t('Delete watchlist confirmation')}
          </p>
          {watchlistName && (
            <p className="text-sm text-textSecondary">
              📋 {watchlistName}
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-surfaceHover hover:bg-border text-textPrimary font-medium py-3 rounded-lg transition-colors"
          >
            {t('No')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-danger hover:bg-red-700 text-white font-medium py-3 rounded-lg transition-colors"
          >
            {t('Yes')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteWatchlistModal;
