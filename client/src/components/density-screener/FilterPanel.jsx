import React, { useRef, useCallback, useState } from 'react';
import { SlidersHorizontal, X, RotateCcw, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { useDensityScreenerStore } from '../../store/densityScreenerStore';

const EXCHANGES = [
  { key: 'binance', label: 'Binance', color: 'yellow' },
  { key: 'okx', label: 'OKX', color: 'blue' },
  { key: 'bybit', label: 'Bybit', color: 'orange' },
];

const EXCHANGE_STYLES = {
  yellow: {
    active: 'bg-yellow-500/20 border-yellow-500/60 text-yellow-400',
    inactive: 'bg-surfaceHover border-border text-textSecondary hover:border-yellow-500/40 hover:text-yellow-400',
  },
  blue: {
    active: 'bg-blue-500/20 border-blue-500/60 text-blue-400',
    inactive: 'bg-surfaceHover border-border text-textSecondary hover:border-blue-500/40 hover:text-blue-400',
  },
  orange: {
    active: 'bg-orange-500/20 border-orange-500/60 text-orange-400',
    inactive: 'bg-surfaceHover border-border text-textSecondary hover:border-orange-500/40 hover:text-orange-400',
  },
};

const MARKET_TYPES = [
  { key: 'futures', label: 'Futures' },
  { key: 'spot', label: 'Spot' },
];

const VOLUME_PRESETS = [
  { label: '$100K', value: 100000 },
  { label: '$300K', value: 300000 },
  { label: '$500K', value: 500000 },
  { label: '$1M', value: 1000000 },
  { label: '$2M', value: 2000000 },
  { label: '$5M', value: 5000000 },
];

const SIDE_OPTIONS = [
  { key: 'Both', label: 'Both' },
  { key: 'BID', label: 'Bids' },
  { key: 'ASK', label: 'Asks' },
];

const AGE_OPTIONS = [
  { label: 'Any', value: 0 },
  { label: '1m+', value: 60 },
  { label: '5m+', value: 300 },
  { label: '15m+', value: 900 },
  { label: '30m+', value: 1800 },
  { label: '1h+', value: 3600 },
  { label: '4h+', value: 14400 },
];

const SORT_OPTIONS = [
  { key: 'volumeUSD', label: 'Volume USD' },
  { key: 'wallAgeMs', label: 'Wall Age' },
  { key: 'percentFromMid', label: 'Distance from Mid' },
];

function formatVolume(value) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `$${value}`;
}

function SectionLabel({ children }) {
  return (
    <div className="text-textSecondary text-xs font-medium uppercase tracking-wide mb-1">
      {children}
    </div>
  );
}

export default function FilterPanel() {
  const {
    filters,
    updateFilter,
    resetFilters,
    fetchWalls,
    getPresets,
    savePreset,
    loadPreset,
    deletePreset,
  } = useDensityScreenerStore();

  const debounceRef = useRef(null);
  const [tokenInput, setTokenInput] = useState('');
  const [presetName, setPresetName] = useState('');
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchWalls();
    }, 400);
  }, [fetchWalls]);

  const handleFilterChange = useCallback(
    (key, value) => {
      updateFilter(key, value);
      debouncedFetch();
    },
    [updateFilter, debouncedFetch],
  );

  // --- Exchange toggle (prevent deselecting last) ---
  const toggleExchange = (exchangeKey) => {
    const current = filters.exchanges || [];
    if (current.includes(exchangeKey) && current.length <= 1) return;
    const next = current.includes(exchangeKey)
      ? current.filter((e) => e !== exchangeKey)
      : [...current, exchangeKey];
    handleFilterChange('exchanges', next);
  };

  // --- Market toggle (prevent deselecting last) ---
  const toggleMarket = (marketKey) => {
    const current = filters.markets || [];
    if (current.includes(marketKey) && current.length <= 1) return;
    const next = current.includes(marketKey)
      ? current.filter((m) => m !== marketKey)
      : [...current, marketKey];
    handleFilterChange('markets', next);
  };

  // --- Volume ---
  const handleVolumeInput = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    if (!isNaN(num)) {
      handleFilterChange('minVolume', num);
    } else if (raw === '') {
      handleFilterChange('minVolume', 0);
    }
  };

  // --- Side ---
  const handleSide = (side) => {
    handleFilterChange('side', side);
  };

  // --- Symbols ---
  const handleTokenKeyDown = (e) => {
    if (e.key === 'Enter' && tokenInput.trim()) {
      e.preventDefault();
      const newSymbols = tokenInput
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const current = filters.symbols || [];
      const merged = [...new Set([...current, ...newSymbols])];
      handleFilterChange('symbols', merged);
      setTokenInput('');
    }
  };

  const addTokens = () => {
    if (!tokenInput.trim()) return;
    const newSymbols = tokenInput
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const current = filters.symbols || [];
    const merged = [...new Set([...current, ...newSymbols])];
    handleFilterChange('symbols', merged);
    setTokenInput('');
  };

  const removeSymbol = (sym) => {
    const current = filters.symbols || [];
    handleFilterChange(
      'symbols',
      current.filter((s) => s !== sym),
    );
  };

  // --- Presets ---
  const presets = getPresets ? getPresets() : [];

  const handleSavePreset = () => {
    if (presetName.trim()) {
      savePreset(presetName.trim());
      setPresetName('');
      setShowPresetInput(false);
    }
  };

  const handleReset = () => {
    resetFilters();
    debouncedFetch();
  };

  const panelContent = (
    <div className="flex flex-col gap-3">
      {/* Exchange selector */}
      <div>
        <SectionLabel>Exchange</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {EXCHANGES.map((ex) => {
            const active = (filters.exchanges || []).includes(ex.key);
            const styles = EXCHANGE_STYLES[ex.color];
            return (
              <button
                key={ex.key}
                onClick={() => toggleExchange(ex.key)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  active ? styles.active : styles.inactive
                }`}
              >
                {ex.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Market type */}
      <div>
        <SectionLabel>Market</SectionLabel>
        <div className="flex gap-1.5">
          {MARKET_TYPES.map((mt) => {
            const active = (filters.markets || []).includes(mt.key);
            return (
              <button
                key={mt.key}
                onClick={() => toggleMarket(mt.key)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  active
                    ? 'bg-accent/20 border-accent/60 text-accent'
                    : 'bg-surfaceHover border-border text-textSecondary hover:bg-accent/10 hover:text-accent'
                }`}
              >
                {mt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Min wall size */}
      <div>
        <SectionLabel>Min Wall Size</SectionLabel>
        <div className="flex items-center gap-2 mb-1.5">
          <input
            type="text"
            value={filters.minVolume ? formatVolume(filters.minVolume) : ''}
            onChange={handleVolumeInput}
            placeholder="$0"
            className="w-24 px-2 py-1 text-xs rounded-lg bg-background border border-border text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accent/60"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {VOLUME_PRESETS.map((vp) => {
            const active = filters.minVolume === vp.value;
            return (
              <button
                key={vp.value}
                onClick={() => handleFilterChange('minVolume', vp.value)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md border transition-colors ${
                  active
                    ? 'bg-accent/20 border-accent/50 text-accent'
                    : 'bg-surfaceHover border-transparent text-textSecondary hover:bg-accent/20 hover:text-accent'
                }`}
              >
                {vp.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Side filter */}
      <div>
        <SectionLabel>Side</SectionLabel>
        <div className="flex gap-1">
          {SIDE_OPTIONS.map((opt) => {
            const active = (filters.side || 'Both') === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => handleSide(opt.key)}
                className={`flex-1 px-2 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  active
                    ? opt.key === 'BID'
                      ? 'bg-green-500/20 border-green-500/50 text-green-400'
                      : opt.key === 'ASK'
                        ? 'bg-red-500/20 border-red-500/50 text-red-400'
                        : 'bg-accent/20 border-accent/50 text-accent'
                    : 'bg-surfaceHover border-border text-textSecondary hover:bg-accent/10 hover:text-textPrimary'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Token filter */}
      <div>
        <SectionLabel>Tokens</SectionLabel>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={handleTokenKeyDown}
            placeholder="BTCUSDT, ETHUSDT…"
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded-lg bg-background border border-border text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accent/60"
          />
          <button
            onClick={addTokens}
            disabled={!tokenInput.trim()}
            className="px-2 py-1 text-xs rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 min-h-[20px]">
          {(filters.symbols || []).length > 0 ? (
            (filters.symbols || []).map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[11px] font-medium rounded-full bg-accent/15 text-accent border border-accent/30"
              >
                {sym}
                <button
                  onClick={() => removeSymbol(sym)}
                  className="ml-0.5 hover:text-red-400 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))
          ) : (
            <span className="text-[11px] text-textSecondary/60 italic">All tokens</span>
          )}
        </div>
      </div>

      {/* Min wall age */}
      <div>
        <SectionLabel>Min Wall Age</SectionLabel>
        <select
          value={filters.minAge || 0}
          onChange={(e) => handleFilterChange('minAge', Number(e.target.value))}
          className="w-full px-2 py-1.5 text-xs rounded-lg bg-background border border-border text-textPrimary focus:outline-none focus:border-accent/60 appearance-none cursor-pointer"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'%3E%3C/polyline%3E%3C/svg%3E")',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          {AGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Max distance from spread */}
      <div>
        <SectionLabel>Max Distance from Spread</SectionLabel>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={filters.maxDistFromMid || 5}
            onChange={(e) => handleFilterChange('maxDistFromMid', parseFloat(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none bg-surfaceHover accent-accent cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-0
              [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
          />
          <span className="text-xs font-mono text-textPrimary min-w-[3rem] text-right">
            {(filters.maxDistFromMid || 5).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Sort by */}
      <div>
        <SectionLabel>Sort By</SectionLabel>
        <div className="flex gap-1.5">
          <select
            value={filters.sort || 'volumeUSD'}
            onChange={(e) => handleFilterChange('sort', e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-background border border-border text-textPrimary focus:outline-none focus:border-accent/60 appearance-none cursor-pointer"
            style={{
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'%3E%3C/polyline%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
            }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              handleFilterChange('order', filters.order === 'desc' ? 'asc' : 'desc')
            }
            className="px-2 py-1.5 text-xs rounded-lg bg-surfaceHover border border-border text-textSecondary hover:text-accent hover:border-accent/40 transition-colors"
            title={filters.order === 'desc' ? 'Descending' : 'Ascending'}
          >
            {filters.order === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Presets */}
      <div>
        <SectionLabel>Presets</SectionLabel>

        {/* Saved presets list */}
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {presets.map((preset) => (
              <span
                key={preset.name}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-surfaceHover text-textSecondary border border-border hover:border-accent/40 hover:text-accent cursor-pointer transition-colors group"
              >
                <button
                  onClick={() => {
                    loadPreset(preset.name);
                    debouncedFetch();
                  }}
                  className="truncate max-w-[100px]"
                >
                  {preset.name}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePreset(preset.name);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Save preset */}
        {showPresetInput ? (
          <div className="flex gap-1.5 mb-2">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
              placeholder="Preset name…"
              autoFocus
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded-lg bg-background border border-border text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accent/60"
            />
            <button
              onClick={handleSavePreset}
              disabled={!presetName.trim()}
              className="px-2 py-1 text-xs rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Save size={12} />
            </button>
            <button
              onClick={() => {
                setShowPresetInput(false);
                setPresetName('');
              }}
              className="px-2 py-1 text-xs rounded-lg bg-surfaceHover text-textSecondary hover:text-textPrimary transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowPresetInput(true)}
            className="flex items-center gap-1 text-xs text-textSecondary hover:text-accent transition-colors mb-2"
          >
            <Save size={12} />
            Save current filters
          </button>
        )}

        {/* Reset */}
        <button
          onClick={handleReset}
          className="flex items-center gap-1 text-xs text-textSecondary hover:text-red-400 transition-colors"
        >
          <RotateCcw size={12} />
          Reset to defaults
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen((v) => !v)}
        className="md:hidden flex items-center gap-1.5 px-3 py-2 mb-2 text-sm font-medium rounded-xl bg-surface border border-border text-textPrimary hover:border-accent/40 transition-colors w-full"
      >
        <SlidersHorizontal size={14} className="text-accent" />
        Filters
        {mobileOpen ? (
          <ChevronUp size={14} className="ml-auto text-textSecondary" />
        ) : (
          <ChevronDown size={14} className="ml-auto text-textSecondary" />
        )}
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-surface rounded-xl border border-border p-4 mb-3">
          {panelContent}
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block bg-surface rounded-xl border border-border p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <SlidersHorizontal size={14} className="text-accent" />
          <span className="text-sm font-semibold text-textPrimary">Filters</span>
        </div>
        {panelContent}
      </div>
    </>
  );
}
