import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { cn } from '../../utils/cn';

const TokenSelector = ({ tokens, value, onChange, placeholder = "Search tokens...", loading = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTokens, setFilteredTokens] = useState(tokens || []);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Filter tokens based on search query (same logic as Market section)
  useEffect(() => {
    if (!tokens || tokens.length === 0) {
      setFilteredTokens([]);
      return;
    }

    if (!searchQuery.trim()) {
      // Show all tokens when no search (same as Market section)
      setFilteredTokens(tokens);
      return;
    }

    const query = searchQuery.toUpperCase();
    const filtered = tokens.filter(token => {
      const fullSymbol = (token.fullSymbol || token.symbol || '').toUpperCase();
      const symbol = (token.symbol || '').toUpperCase();
      return fullSymbol.includes(query) || symbol.includes(query);
    });
    
    setFilteredTokens(filtered);
  }, [searchQuery, tokens]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const selectedToken = tokens?.find(t => {
    const fullSymbol = t.fullSymbol || t.symbol || '';
    return fullSymbol === value;
  });

  const handleSelect = (token) => {
    // Use fullSymbol (e.g., "BTCUSDT") same as Market section
    const symbol = token.fullSymbol || token.symbol || '';
    onChange(symbol);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setSearchQuery('');
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        className={cn(
          "w-full bg-surface border border-border rounded-lg px-4 py-2 pr-10 text-textPrimary",
          "focus-within:ring-2 focus-within:ring-accent focus-within:border-transparent",
          "cursor-pointer transition-all flex items-center justify-between"
        )}
        onClick={() => !loading && setIsOpen(!isOpen)}
      >
        <div className="flex-1 min-w-0">
          {value ? (
            <div className="flex items-center justify-between">
              <span className="text-textPrimary font-medium">{value}</span>
              <button
                onClick={handleClear}
                className="ml-2 text-textSecondary hover:text-textPrimary"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <span className="text-textSecondary">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          size={18}
          className={cn(
            "text-textSecondary transition-transform",
            isOpen && "transform rotate-180"
          )}
        />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tokens..."
                className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded text-textPrimary placeholder-textSecondary focus:outline-none focus:ring-2 focus:ring-accent"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          
          <div className="overflow-y-auto flex-1 max-h-64">
            {loading ? (
              <div className="p-4 text-center text-textSecondary">Loading tokens...</div>
            ) : filteredTokens.length === 0 ? (
              <div className="p-4 text-center text-textSecondary">
                {searchQuery ? 'No tokens found' : 'No tokens available'}
              </div>
            ) : (
              <div className="py-1">
                {filteredTokens.map((token) => {
                  const fullSymbol = token.fullSymbol || token.symbol || '';
                  const symbol = token.symbol || fullSymbol.replace(/USDT$/i, '');
                  const isSelected = value === fullSymbol;
                  return (
                    <div
                      key={fullSymbol}
                      onClick={() => handleSelect(token)}
                      className={cn(
                        "px-4 py-2 cursor-pointer hover:bg-surfaceHover transition-colors",
                        isSelected && "bg-accent/10"
                      )}
                    >
                      <div className="text-textPrimary font-medium">{symbol}</div>
                      <div className="text-xs text-textSecondary">{fullSymbol}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TokenSelector;
