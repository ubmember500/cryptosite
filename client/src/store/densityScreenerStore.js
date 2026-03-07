import { create } from 'zustand';
import api from '../services/api';

// Default filter values
const DEFAULT_FILTERS = {
  exchanges: ['binance', 'bybit', 'okx'],
  markets: ['futures', 'spot'],
  minVolume: 100000,    // $100K — lower default to surface more walls (matches stakan.live coverage)
  side: 'Both',
  symbols: [],          // empty = all symbols
  hiddenSymbols: [],    // tokens to exclude from results
  minAge: 0,            // seconds — 0 = no minimum
  maxDistFromMid: 10,   // percent
  sort: 'volumeUSD',
  order: 'desc',
  limit: 1000,          // higher limit to accommodate deeper scanning results
};

const PRESETS_STORAGE_KEY = 'density-screener-presets';
const LAST_FILTERS_KEY = 'density-screener-last-filters';

// Load last-used filters from localStorage
function loadLastFilters() {
  try {
    const stored = localStorage.getItem(LAST_FILTERS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_FILTERS };
}

// Save filters to localStorage
function saveLastFilters(filters) {
  try {
    localStorage.setItem(LAST_FILTERS_KEY, JSON.stringify(filters));
  } catch { /* ignore */ }
}

export const useDensityScreenerStore = create((set, get) => ({
  // ─── Data state ──────────────────────────────────────────
  walls: [],
  symbols: {},         // { binance_futures: ['BTCUSDT', ...], ... }
  scannerStatus: null, // { running, exchanges, tracker }
  loading: false,
  error: null,
  lastUpdated: null,

  // ─── Filter state ────────────────────────────────────────
  filters: loadLastFilters(),

  // ─── Auto-poll state ─────────────────────────────────────
  pollIntervalId: null,
  isFetching: false,

  // ─── Actions: Data fetching ──────────────────────────────

  /**
   * Fetch walls from the API with current filters.
   * Guards against concurrent fetches.
   */
  fetchWalls: async () => {
    const state = get();
    if (state.isFetching) return;
    
    set({ isFetching: true, error: null });
    
    try {
      const { filters } = state;
      const params = {
        exchanges: filters.exchanges.join(','),
        markets: filters.markets.join(','),
        minVolume: filters.minVolume,
        side: filters.side,
        minAge: filters.minAge,
        maxDistFromMid: filters.maxDistFromMid,
        sort: filters.sort,
        order: filters.order,
        limit: filters.limit,
      };
      
      // Only add symbols param if user selected specific symbols
      if (filters.symbols.length > 0) {
        params.symbols = filters.symbols.join(',');
      }
      
      // Add hidden symbols (exclude list)
      if (filters.hiddenSymbols && filters.hiddenSymbols.length > 0) {
        params.excludeSymbols = filters.hiddenSymbols.join(',');
      }
      
      const response = await api.get('/density-screener/walls', { 
        params,
        timeout: 15000,
      });
      
      set({
        walls: response.data.walls || [],
        lastUpdated: new Date().toISOString(),
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Failed to fetch walls';
      set({ error: message });
    } finally {
      set({ isFetching: false, loading: false });
    }
  },

  /**
   * Fetch available symbols for the token selector.
   */
  fetchSymbols: async () => {
    try {
      const response = await api.get('/density-screener/symbols', { timeout: 10000 });
      set({ symbols: response.data.symbols || {} });
    } catch (error) {
      console.error('[DensityStore] Failed to fetch symbols:', error.message);
    }
  },

  /**
   * Fetch scanner status.
   */
  fetchStatus: async () => {
    try {
      const response = await api.get('/density-screener/status', { timeout: 5000 });
      set({ scannerStatus: response.data });
    } catch (error) {
      console.error('[DensityStore] Failed to fetch status:', error.message);
    }
  },

  // ─── Actions: Filter management ──────────────────────────

  /**
   * Update a single filter value. Auto-saves to localStorage.
   */
  updateFilter: (key, value) => {
    set((state) => {
      const newFilters = { ...state.filters, [key]: value };
      saveLastFilters(newFilters);
      return { filters: newFilters };
    });
  },

  /**
   * Replace all filters at once (e.g. when loading a preset).
   */
  setFilters: (filters) => {
    const merged = { ...DEFAULT_FILTERS, ...filters };
    saveLastFilters(merged);
    set({ filters: merged });
  },

  /**
   * Reset filters to defaults.
   */
  resetFilters: () => {
    saveLastFilters(DEFAULT_FILTERS);
    set({ filters: { ...DEFAULT_FILTERS } });
  },

  // ─── Actions: Presets (localStorage) ─────────────────────

  /**
   * Get all saved presets.
   * @returns {Array<{ name: string, filters: object }>}
   */
  getPresets: () => {
    try {
      const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  },

  /**
   * Save current filters as a named preset.
   */
  savePreset: (name) => {
    const { filters } = get();
    const presets = get().getPresets();
    
    // Replace if name exists, otherwise append
    const existingIndex = presets.findIndex(p => p.name === name);
    if (existingIndex >= 0) {
      presets[existingIndex].filters = { ...filters };
    } else {
      presets.push({ name, filters: { ...filters } });
    }
    
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch { /* ignore */ }
  },

  /**
   * Load a preset by name. Replaces current filters.
   */
  loadPreset: (name) => {
    const presets = get().getPresets();
    const preset = presets.find(p => p.name === name);
    if (preset) {
      get().setFilters(preset.filters);
    }
  },

  /**
   * Delete a preset by name.
   */
  deletePreset: (name) => {
    const presets = get().getPresets().filter(p => p.name !== name);
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch { /* ignore */ }
  },

  // ─── Actions: Auto-polling ───────────────────────────────

  /**
   * Start auto-polling. Fetches immediately, then at interval.
   * Only polls when document is visible.
   */
  startPolling: (intervalMs = 7000) => {
    const state = get();
    if (state.pollIntervalId) return; // Already polling
    
    // Initial fetch
    set({ loading: true });
    get().fetchWalls();
    get().fetchStatus();
    
    const timerId = setInterval(() => {
      // Only fetch if tab is visible
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      get().fetchWalls();
      // Fetch status less frequently (every 3rd poll)
      const now = Date.now();
      if (!get()._lastStatusPoll || now - get()._lastStatusPoll > 20000) {
        get().fetchStatus();
        set({ _lastStatusPoll: now });
      }
    }, intervalMs);
    
    set({ pollIntervalId: timerId, _lastStatusPoll: Date.now() });
  },

  /**
   * Stop auto-polling.
   */
  stopPolling: () => {
    const { pollIntervalId } = get();
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      set({ pollIntervalId: null });
    }
  },

  // ─── Actions: CSV Export ─────────────────────────────────

  /**
   * Export current walls to CSV and trigger download.
   */
  exportCSV: () => {
    const { walls } = get();
    if (!walls.length) return;
    
    const headers = ['Exchange', 'Symbol', 'Market', 'Side', 'Price', 'Volume USD', '% From Mid', 'Wall Age (min)', 'Volume (coins)', 'Scans Seen'];
    const rows = walls.map(w => [
      w.exchange,
      w.symbol,
      w.market,
      w.side,
      w.price,
      w.volumeUSD?.toFixed(2),
      w.percentFromMid?.toFixed(3),
      Math.floor((w.wallAgeMs || 0) / 60000),
      w.volume,
      w.scansSeen,
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `density-screener-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
}));
