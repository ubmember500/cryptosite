import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMarketStore } from '../../store/marketStore';
import { useMarketFlags, FLAG_COLORS } from '../../hooks/useMarketFlags';
import { ChevronUp, ChevronDown, Flag } from 'lucide-react';
import { cn } from '../../utils/cn';
import LoadingSpinner from '../common/LoadingSpinner';
import TokenContextMenu from './TokenContextMenu';

/** Hover tooltip that appears above column headers */
const HeaderTooltip = ({ text, parentRef }) => {
  if (!text || !parentRef?.current) return null;
  return (
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none">
      <div className="bg-surface border border-border rounded-lg shadow-xl px-3 py-2 text-xs text-textPrimary leading-relaxed max-w-[220px] text-center whitespace-normal">
        {text}
      </div>
    </div>
  );
};

const BinanceMarketTable = ({ onTokenSelect, highlightToken }) => {
  const { t } = useTranslation();
  const {
    binanceTokens,
    loadingBinance,
    binanceError,
    selectedToken,
    setSelectedToken,
    exchange,
    exchangeType,
    selectedWatchlist,
    watchlists,
    addTokenToWatchlist,
  } = useMarketStore();
  const tokenToHighlight = highlightToken ?? selectedToken;
  const handleRowClick = (token) => {
    if (onTokenSelect) {
      onTokenSelect(token);
    } else {
      setSelectedToken(token);
    }
  };
  const { getFlag, setFlag, removeFlag, isFlagged } = useMarketFlags();

  const [sortConfig, setSortConfig] = useState({ key: 'volume24h', direction: 'desc' });
  const [sortByFlag, setSortByFlag] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [openPopoverFor, setOpenPopoverFor] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, token }
  const [hoveredHeader, setHoveredHeader] = useState(null);
  const headerRef24h = useRef(null);
  const headerRefNatr = useRef(null);
  const headerRefVol = useRef(null);
  const popoverRef = useRef(null);

  // Close popover on click outside
  useEffect(() => {
    if (!openPopoverFor) return;
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpenPopoverFor(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openPopoverFor]);

  const VOLUME_HIGH_THRESHOLD = 100_000_000;

  const formatVolume = (volume) => {
    if (volume == null || !Number.isFinite(Number(volume))) return t('N/A');
    const v = Number(volume);
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)} ${t('million short')}`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined || isNaN(value)) {
      return <span className="text-textSecondary">{t('N/A')}</span>;
    }
    const isPositive = value >= 0;
    return (
      <span className={cn(isPositive ? 'text-green-400' : 'text-danger')}>
        {isPositive ? '+' : ''}{value.toFixed(2)}%
      </span>
    );
  };

  const formatPrice = (price) => {
    if (!price || isNaN(price)) return t('N/A');
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key) {
        return { key, direction: 'desc' };
      }

      return {
        key,
        direction: prev.direction === 'desc' ? 'asc' : 'desc',
      };
    });
  };

  const handleContextMenu = (e, token) => {
    e.preventDefault(); // Prevent default browser context menu
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      token,
    });
  };

  const handleAddToWatchlist = (watchlistId) => {
    if (contextMenu && contextMenu.token) {
      addTokenToWatchlist(watchlistId, contextMenu.token);
      const watchlist = watchlists.find(w => w.id === watchlistId);
      console.log(`Added ${contextMenu.token.symbol} to ${watchlist?.name}`);
      // TODO: Show toast notification
    }
  };

  // Numeric columns: always compare as numbers (same logic for Binance, Bybit, OKX)
  const NUMERIC_SORT_KEYS = ['volume24h', 'priceChangePercent24h', 'natr'];

  const compareValues = (key, aValue, bValue, direction) => {
    const isNumeric = NUMERIC_SORT_KEYS.includes(key);
    if (isNumeric) {
      const a = aValue != null && aValue !== '' ? Number(aValue) : NaN;
      const b = bValue != null && bValue !== '' ? Number(bValue) : NaN;
      // Treat 0 / null / NaN as "no data" — always push to bottom regardless of direction
      const aValid = Number.isFinite(a) && a !== 0;
      const bValid = Number.isFinite(b) && b !== 0;
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return direction === 'asc' ? a - b : b - a;
    }
    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      const a = aValue.toLowerCase();
      const b = bValue.toLowerCase();
      if (a < b) return direction === 'asc' ? -1 : 1;
      if (a > b) return direction === 'asc' ? 1 : -1;
      return 0;
    }
    return 0;
  };

  const sortedTokens = useMemo(() => {
    // Determine which tokens to display
    let tokensToSort = [];
    
    if (selectedWatchlist) {
      // Show watchlist tokens
      const watchlist = watchlists.find(w => w.id === selectedWatchlist);
      tokensToSort = watchlist ? [...watchlist.tokens] : [];
    } else {
      // Show exchange tokens
      tokensToSort = [...binanceTokens];
    }
    
    if (!tokensToSort.length) return tokensToSort;
    const list = tokensToSort;
    const { key, direction } = sortConfig;

    list.sort((a, b) => {
      if (sortByFlag) {
        const aFlagged = isFlagged(exchange, exchangeType, a.fullSymbol);
        const bFlagged = isFlagged(exchange, exchangeType, b.fullSymbol);
        if (aFlagged && !bFlagged) return -1;
        if (!aFlagged && bFlagged) return 1;
      }
      const aValue = a[key];
      const bValue = b[key];
      return compareValues(key, aValue, bValue, direction);
    });
    return list;
  }, [binanceTokens, sortConfig, sortByFlag, exchange, exchangeType, isFlagged, selectedWatchlist, watchlists]);

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) {
      return <ChevronUp className="h-4 w-4 text-textSecondary opacity-0 group-hover:opacity-100" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="h-4 w-4 text-accent" />
    ) : (
      <ChevronDown className="h-4 w-4 text-accent" />
    );
  };

  // Show loader only for exchanges (not watchlists)
  const showFullLoader = !selectedWatchlist && loadingBinance && binanceTokens.length === 0;

  if (showFullLoader) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  // Show error only for exchanges (not watchlists)
  if (!selectedWatchlist && binanceError) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-danger text-center">
          <p className="font-medium">{t('Error loading tokens')}</p>
          <p className="text-sm text-textSecondary mt-1">{binanceError}</p>
        </div>
      </div>
    );
  }

  if (sortedTokens.length === 0) {
    // Different message for empty watchlist vs no search results
    if (selectedWatchlist) {
      const watchlist = watchlists.find(w => w.id === selectedWatchlist);
      return (
        <div className="flex items-center justify-center py-12">
          <div className="text-textSecondary text-center">
            <p className="font-medium">📋 {watchlist?.name || 'Watchlist'}</p>
            <p className="text-sm mt-1">No tokens in this watchlist yet.</p>
            <p className="text-sm mt-1">Click on tokens from exchanges to add them here.</p>
          </div>
        </div>
      );
    }
    
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-textSecondary text-center">
          <p className="font-medium">{t('No tokens found')}</p>
          <p className="text-sm mt-1">{t('Try adjusting your search.')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full">
        <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <tr>
            <th className="w-10 px-2 py-3 text-left">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSortByFlag((v) => !v);
                }}
                className={cn(
                  'text-xs font-medium uppercase tracking-wider rounded px-1.5 py-1 transition-colors',
                  sortByFlag
                    ? 'bg-accent/20 text-accent'
                    : 'text-textSecondary hover:text-textPrimary hover:bg-surfaceHover'
                )}
                title={t('Sort by flag')}
              >
                {t('Flag')}
              </button>
            </th>
            <th
              className="px-4 py-3 text-left text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group"
              onClick={() => handleSort('symbol')}
            >
              <div className="flex items-center gap-1">
                {t('Instrument')}
                <SortIcon columnKey="symbol" />
              </div>
            </th>
            <th
              ref={headerRef24h}
              className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group relative"
              onClick={() => handleSort('priceChangePercent24h')}
              onMouseEnter={() => setHoveredHeader('24h')}
              onMouseLeave={() => setHoveredHeader(null)}
            >
              {hoveredHeader === '24h' && <HeaderTooltip text={t('24h % tooltip')} parentRef={headerRef24h} />}
              <div className="flex items-center justify-end gap-1">
                {t('24h %')}
                <SortIcon columnKey="priceChangePercent24h" />
              </div>
            </th>
            <th
              ref={headerRefNatr}
              className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group relative"
              onClick={() => handleSort('natr')}
              onMouseEnter={() => setHoveredHeader('natr')}
              onMouseLeave={() => setHoveredHeader(null)}
            >
              {hoveredHeader === 'natr' && <HeaderTooltip text={t('NATR tooltip')} parentRef={headerRefNatr} />}
              <div className="flex items-center justify-end gap-1">
                {t('NATR')}
                <SortIcon columnKey="natr" />
              </div>
            </th>
            <th
              ref={headerRefVol}
              className="px-4 py-3 text-right text-xs font-medium text-textSecondary uppercase tracking-wider cursor-pointer hover:text-textPrimary group relative"
              onClick={() => handleSort('volume24h')}
              onMouseEnter={() => setHoveredHeader('vol')}
              onMouseLeave={() => setHoveredHeader(null)}
            >
              {hoveredHeader === 'vol' && <HeaderTooltip text={t('Vol 24h tooltip')} parentRef={headerRefVol} />}
              <div className="flex items-center justify-end gap-1">
                {t('Vol 24h')} ($)
                <SortIcon columnKey="volume24h" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'rgba(28,40,67,0.6)' }}>
          {sortedTokens.map((token) => {
            const flagged = isFlagged(exchange, exchangeType, token.fullSymbol);
            const flagColor = getFlag(exchange, exchangeType, token.fullSymbol);
            const showFlag = flagged || hoveredRow === token.fullSymbol;
            const isPopoverOpen = openPopoverFor === token.fullSymbol;

            return (
              <tr
                key={token.fullSymbol}
                className={cn(
                  'cursor-pointer transition-all duration-150 group',
                  tokenToHighlight?.fullSymbol === token.fullSymbol
                    ? 'bg-accent/[0.07] border-l-2 border-accent'
                    : 'hover:bg-surfaceHover/60 border-l-2 border-transparent'
                )}
                onClick={() => handleRowClick(token)}
                onContextMenu={(e) => handleContextMenu(e, token)}
                onMouseEnter={() => setHoveredRow(token.fullSymbol)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                <td
                  className="px-2 py-3 w-10 align-middle relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div ref={isPopoverOpen ? popoverRef : null} className="relative inline-block">
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center justify-center w-7 h-7 rounded transition-opacity',
                        showFlag ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                      onClick={() => setOpenPopoverFor(isPopoverOpen ? null : token.fullSymbol)}
                      title={flagged ? t('Change flag color') : t('Flag token')}
                      aria-label={flagged ? t('Change flag color') : t('Flag token')}
                    >
                      <Flag
                        className="w-4 h-4 flex-shrink-0"
                        style={flagColor ? { color: flagColor, fill: flagColor } : {}}
                        strokeWidth={flagged ? 2 : 1.5}
                      />
                    </button>
                    {isPopoverOpen && (
                      <div
                        className="absolute left-0 top-full mt-1 z-20 flex items-center gap-2 bg-surface border border-border rounded-lg shadow-lg p-2"
                        style={{ minWidth: '180px' }}
                      >
                        <Flag className="w-4 h-4 text-textSecondary flex-shrink-0" />
                        <div className="flex items-center gap-1.5">
                          {FLAG_COLORS.map(({ hex, id }) => (
                            <button
                              key={id}
                              type="button"
                              className="w-6 h-6 rounded-full border-2 border-transparent hover:border-white/50 focus:outline-none focus:ring-2 focus:ring-accent"
                              style={{ backgroundColor: hex }}
                              onClick={() => {
                                setFlag(exchange, exchangeType, token.fullSymbol, hex);
                                setOpenPopoverFor(null);
                              }}
                              title={hex}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          className="text-xs text-textSecondary hover:text-textPrimary whitespace-nowrap ml-1"
                          onClick={() => {
                            removeFlag(exchange, exchangeType, token.fullSymbol);
                            setOpenPopoverFor(null);
                          }}
                        >
                          {t('Remove flag')}
                        </button>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-1 py-3 whitespace-nowrap">
                  <div className="text-textPrimary font-bold text-sm leading-tight">{token.symbol}</div>
                  <div className="text-[11px] mt-0.5 text-textSecondary">{token.fullSymbol}</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  {formatPercent(token.priceChangePercent24h)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  {token.natr != null ? (
                    <span
                      className="font-semibold"
                      style={{ color: '#f59e0b', textShadow: '0 0 8px rgba(245,158,11,0.45)' }}
                    >
                      {token.natr.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-textSecondary opacity-40 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span
                    className={cn(
                      (token.volume24h != null && Number(token.volume24h) >= VOLUME_HIGH_THRESHOLD)
                        ? 'font-semibold text-fuchsia-400'
                        : 'text-textPrimary'
                    )}
                  >
                    {formatVolume(token.volume24h)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Context Menu */}
    {contextMenu && (
      <TokenContextMenu
        position={{ x: contextMenu.x, y: contextMenu.y }}
        token={contextMenu.token}
        watchlists={watchlists}
        onAddToWatchlist={handleAddToWatchlist}
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  );
};

export default BinanceMarketTable;
