import React, { useRef, useCallback, useState } from 'react';
import { SlidersHorizontal, X, RotateCcw, Save, ChevronDown, ChevronUp, Settings } from 'lucide-react';
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
  const [showIndividualSettings, setShowIndividualSettings] = useState(false);

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
    <div className="flex flex-col gap-2.5">
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
        {(filters.symbols || []).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(filters.symbols || []).map((sym) => (
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
            ))}
          </div>
        )}
      </div>

      {/* Individual Settings */}
      <div>
        <button
          onClick={() => setShowIndividualSettings(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/60 transition-colors"
        >
          <Settings size={14} />
          Individual Settings
        </button>
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
            value={filters.maxDistFromMid || 10}
            onChange={(e) => handleFilterChange('maxDistFromMid', parseFloat(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none bg-surfaceHover accent-accent cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-0
              [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
          />
          <span className="text-xs font-mono text-textPrimary min-w-[3rem] text-right">
            {(filters.maxDistFromMid || 10).toFixed(1)}%
          </span>
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
      <div className="hidden md:block bg-surface rounded-xl border border-border p-3">
        <div className="flex items-center gap-1.5 mb-2.5">
          <SlidersHorizontal size={13} className="text-accent" />
          <span className="text-xs font-semibold text-textPrimary uppercase tracking-wide">Filters</span>
        </div>
        {panelContent}
      </div>

      {/* Individual Settings Modal */}
      {showIndividualSettings && (
        <IndividualSettingsModal onClose={() => setShowIndividualSettings(false)} />
      )}
    </>
  );
}

// ─── Individual Settings Modal ────────────────────────────────────────────────

const EXCHANGES_MARKETS = [
  { exchange: 'binance', market: 'futures', label: 'Binance Futures', color: 'text-yellow-400' },
  { exchange: 'binance', market: 'spot',    label: 'Binance Spot',    color: 'text-yellow-400' },
  { exchange: 'bybit',   market: 'futures', label: 'Bybit Futures',   color: 'text-orange-400' },
  { exchange: 'bybit',   market: 'spot',    label: 'Bybit Spot',      color: 'text-orange-400' },
  { exchange: 'okx',     market: 'futures', label: 'OKX Futures',     color: 'text-blue-400' },
  { exchange: 'okx',     market: 'spot',    label: 'OKX Spot',        color: 'text-blue-400' },
];

const PER_PAGE = 20;

function formatWallSize(val) {
  if (!val && val !== 0) return '-';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(val % 1_000 === 0 ? 0 : 1)}K`;
  return String(val);
}

function parseWallInput(raw) {
  if (!raw || !raw.trim()) return null;
  let s = raw.trim().toUpperCase().replace(/[$,\s]/g, '');
  let multiplier = 1;
  if (s.endsWith('M')) { multiplier = 1_000_000; s = s.slice(0, -1); }
  else if (s.endsWith('K')) { multiplier = 1_000; s = s.slice(0, -1); }
  const num = parseFloat(s);
  if (isNaN(num) || num < 0) return null;
  return Math.round(num * multiplier);
}

function EditableCell({ value, color, onSave }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef(null);

  const startEdit = () => {
    setDraft(value ? formatWallSize(value) : '');
    setEditing(true);
  };

  React.useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const parsed = parseWallInput(draft);
    if (parsed !== null && parsed !== value) {
      onSave(parsed);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-full px-1.5 py-0.5 text-xs rounded bg-background border border-accent/60 text-textPrimary focus:outline-none text-center"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className={`w-full text-center text-xs cursor-pointer hover:underline ${value ? `${color} font-medium` : 'text-textSecondary/40'}`}
    >
      {value ? formatWallSize(value) : '-'}
    </button>
  );
}

function IndividualSettingsModal({ onClose }) {
  const [activeTab, setActiveTab] = React.useState('individual');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [onlyChanged, setOnlyChanged] = React.useState(false);

  const {
    symbols,
    tokenSettings,
    tokenSettingsLoaded,
    fetchTokenSettings,
    upsertTokenSetting,
    resetTokenSettings,
  } = useDensityScreenerStore();

  // Fetch token settings on mount
  React.useEffect(() => {
    if (!tokenSettingsLoaded) fetchTokenSettings();
  }, [tokenSettingsLoaded, fetchTokenSettings]);

  // Build unique tickers from all exchange symbol lists
  const allTickers = React.useMemo(() => {
    const set = new Set();
    Object.values(symbols).forEach((arr) => {
      if (Array.isArray(arr)) {
        arr.forEach((sym) => {
          // Strip USDT / USDC / USD suffix to get base ticker
          const base = sym.replace(/(USDT|USDC|USD)$/i, '');
          if (base) set.add(base);
        });
      }
    });
    // Also include tickers from existing settings (in case symbols haven't loaded yet)
    tokenSettings.forEach((s) => set.add(s.ticker));
    return Array.from(set).sort();
  }, [symbols, tokenSettings]);

  // Build a lookup map: "TICKER|exchange|market" → minWallSize
  const settingsMap = React.useMemo(() => {
    const map = new Map();
    tokenSettings.forEach((s) => {
      map.set(`${s.ticker}|${s.exchange}|${s.market}`, s.minWallSize);
    });
    return map;
  }, [tokenSettings]);

  // Filter tickers
  const filteredTickers = React.useMemo(() => {
    let list = allTickers;

    if (search.trim()) {
      const q = search.trim().toUpperCase();
      list = list.filter((t) => t.includes(q));
    }

    if (onlyChanged) {
      list = list.filter((t) =>
        EXCHANGES_MARKETS.some((em) => settingsMap.has(`${t}|${em.exchange}|${em.market}`)),
      );
    }

    return list;
  }, [allTickers, search, onlyChanged, settingsMap]);

  const totalPages = Math.max(1, Math.ceil(filteredTickers.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageTickers = filteredTickers.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  // When search or filter changes, reset to page 1
  React.useEffect(() => { setPage(1); }, [search, onlyChanged]);

  const handleCellSave = async (ticker, exchange, market, minWallSize) => {
    try {
      await upsertTokenSetting({ ticker, exchange, market, minWallSize });
    } catch { /* store already logs */ }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all individual token settings to defaults?')) return;
    try {
      await resetTokenSettings();
    } catch { /* store already logs */ }
  };

  // Pagination range helper
  const pageButtons = React.useMemo(() => {
    const maxButtons = 7;
    if (totalPages <= maxButtons) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const half = Math.floor(maxButtons / 2);
    let start = Math.max(1, safePage - half);
    let end = start + maxButtons - 1;
    if (end > totalPages) { end = totalPages; start = Math.max(1, end - maxButtons + 1); }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [totalPages, safePage]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-[900px] mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-accent text-lg font-bold tracking-wide uppercase">Settings</h2>
          <div className="flex items-center gap-2">
            <button onClick={handleReset} className="p-1.5 rounded-lg text-textSecondary hover:text-red-400 hover:bg-surfaceHover transition-colors" title="Reset all individual settings">
              <RotateCcw size={16} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-textSecondary hover:text-textPrimary hover:bg-surfaceHover transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setActiveTab('main')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'main'
                ? 'text-accent border-accent'
                : 'text-textSecondary border-transparent hover:text-textPrimary'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <SlidersHorizontal size={14} />
              Main
            </span>
          </button>
          <button
            onClick={() => setActiveTab('individual')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'individual'
                ? 'text-accent border-accent'
                : 'text-textSecondary border-transparent hover:text-textPrimary'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <span className="text-base font-bold">$</span>
              Individual
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'main' ? (
            <div className="p-6 text-center text-textSecondary text-sm">
              <p>Main settings are available in the sidebar filter panel.</p>
            </div>
          ) : (
            <div className="p-4">
              {/* Search + Only changed */}
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ticker…"
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-background border border-border text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accent/60"
                />
                <label className="flex items-center gap-2 text-sm text-textSecondary cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={onlyChanged}
                    onChange={(e) => setOnlyChanged(e.target.checked)}
                    className="rounded border-border bg-background text-accent focus:ring-accent/50"
                  />
                  Only changed
                </label>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surfaceHover/50 border-b border-border">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-accent sticky left-0 bg-surfaceHover/50">Ticker</th>
                      {EXCHANGES_MARKETS.map((em) => (
                        <th key={`${em.exchange}_${em.market}`} className="px-3 py-2.5 text-center text-xs font-semibold text-accent whitespace-nowrap">
                          {em.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {!tokenSettingsLoaded ? (
                      <tr><td colSpan={7} className="text-center py-8 text-textSecondary text-sm">Loading…</td></tr>
                    ) : pageTickers.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-textSecondary text-sm">No tickers found</td></tr>
                    ) : pageTickers.map((ticker, i) => (
                      <tr key={ticker} className={`border-b border-border/50 ${i % 2 === 0 ? 'bg-surface' : 'bg-surfaceHover/30'} hover:bg-surfaceHover/60 transition-colors`}>
                        <td className="px-4 py-2 text-textSecondary font-medium text-xs sticky left-0 bg-inherit">{ticker}</td>
                        {EXCHANGES_MARKETS.map((em) => {
                          const key = `${ticker}|${em.exchange}|${em.market}`;
                          const val = settingsMap.get(key) ?? null;
                          return (
                            <td key={`${em.exchange}_${em.market}`} className="px-3 py-1.5">
                              <EditableCell
                                value={val}
                                color={em.color}
                                onSave={(newVal) => handleCellSave(ticker, em.exchange, em.market, newVal)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 mt-4">
                  <button onClick={() => setPage(1)} disabled={safePage === 1} className="px-2 py-1 text-xs rounded border border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover disabled:opacity-30 transition-colors">&laquo;</button>
                  <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} className="px-2 py-1 text-xs rounded border border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover disabled:opacity-30 transition-colors">&lsaquo;</button>
                  {pageButtons.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                        p === safePage
                          ? 'bg-accent/20 border-accent/50 text-accent font-semibold'
                          : 'border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} className="px-2 py-1 text-xs rounded border border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover disabled:opacity-30 transition-colors">&rsaquo;</button>
                  <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} className="px-2 py-1 text-xs rounded border border-border text-textSecondary hover:text-textPrimary hover:bg-surfaceHover disabled:opacity-30 transition-colors">&raquo;</button>
                </div>
              )}

              <p className="text-textSecondary/60 text-[11px] mt-3 text-center">
                Click any cell to set a custom min wall size. Enter values like 500K, 1.5M, 50000.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
