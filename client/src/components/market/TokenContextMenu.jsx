import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus } from 'lucide-react';

const TokenContextMenu = ({ position, token, watchlists, onAddToWatchlist, onClose }) => {
  const { t } = useTranslation();
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  if (!position) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[200px]"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {watchlists.length === 0 ? (
        <div className="px-4 py-3 text-sm text-textSecondary">
          {t('No watchlists')}
        </div>
      ) : (
        <>
          <div className="px-3 py-2 text-xs font-semibold text-textSecondary uppercase">
            {t('Add to watchlist')}
          </div>
          {watchlists.map((watchlist) => (
            <button
              key={watchlist.id}
              onClick={() => {
                onAddToWatchlist(watchlist.id);
                onClose();
              }}
              className="w-full px-4 py-2 text-left text-sm text-textPrimary hover:bg-surfaceHover transition-colors flex items-center justify-between group"
            >
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-textSecondary group-hover:text-accent" />
                {watchlist.name}
              </span>
              <span className="text-xs text-textSecondary">
                {watchlist.tokens.length}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
};

export default TokenContextMenu;
