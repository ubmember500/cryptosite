import { create } from 'zustand';
import { wallScannerService } from '../services/wallScannerService';

const isRequestCanceled = (error) => {
  if (!error) return false;
  return (
    error.name === 'AbortError' ||
    error.name === 'CanceledError' ||
    error.code === 'ERR_CANCELED' ||
    String(error.message || '').toLowerCase() === 'canceled'
  );
};

export const useWallScannerStore = create((set, get) => ({
  // Settings - Default: Binance + Bybit + OKX Futures
  cardConfigs: [
    { exchange: 'binance', market: 'futures', minVolume: 350000, time: 3 },
  ],
  depth: 10,         // max % from mid (0.5-10)
  radius: 4,         // grouping radius (1-10)
  isRunning: false,
  intervalId: null,
  scanIntervalSeconds: 30,

  // Data
  walls: [],
  densityMaps: {},
  densityMeta: {},
  allSymbols: [],
  loading: false,
  error: null,
  lastUpdated: null,
  isFetching: false,
  activeAbortController: null,

  updateSettings: (partial) => {
    set(partial);
  },

  fetchAllSymbols: async () => {
    try {
      const { cardConfigs } = get();

      // Derive unique exchange+market pairs from enabled cards
      const pairs = [];
      const seen = new Set();
      for (const cfg of cardConfigs) {
        const key = `${cfg.exchange}_${cfg.market}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ exchange: cfg.exchange, market: cfg.market });
        }
      }

      // If no cards are enabled, fall back to all exchanges futures
      if (pairs.length === 0) {
        pairs.push(
          { exchange: 'binance', market: 'futures' },
        );
      }

      const lists = await Promise.all(
        pairs.map(async ({ exchange, market }) => {
          try {
            const symbols = await wallScannerService.getTopSymbols(exchange, market);
            return Array.isArray(symbols) ? symbols : [];
          } catch (error) {
            console.error(`Failed to fetch symbols for ${exchange}/${market}:`, error);
            return [];
          }
        })
      );

      const merged = Array.from(new Set(lists.flat())).sort((a, b) => a.localeCompare(b));
      set({ allSymbols: merged });
    } catch (error) {
      console.error('Failed to fetch symbols:', error);
    }
  },

  fetchWalls: async () => {
    const state = get();

    if (state.isFetching) {
      return;
    }

    const isFirstLoad = state.walls.length === 0;

    if (isFirstLoad) {
      set({ loading: true });
    }
    set({ error: null, isFetching: true });

    try {
      const { cardConfigs, depth, radius } = state;

      let params;
      if (cardConfigs.length > 0) {
        params = {
          configs: JSON.stringify(cardConfigs.map((c) => ({
            exchange: c.exchange,
            market: c.market,
            minVolume: c.minVolume,
          }))),
          depth,
          radius,
        };
      } else {
        params = {
          exchanges: 'binance',
          depth,
          radius,
          minVolume: 300000,
        };
      }

      // Add timeout to prevent hanging
      const controller = new AbortController();
      let didTimeout = false;
      set({ activeAbortController: controller });
      const timeoutId = setTimeout(() => {
        didTimeout = true;
        console.warn('[WallScanner] Scan timed out after 90 seconds');
        controller.abort();
      }, 90000); // 90 second timeout (fast native scanner is much quicker)

      try {
        console.log('[WallScanner] Starting scan with params:', params);
        const data = await wallScannerService.scan(params, controller.signal);
        clearTimeout(timeoutId);
        console.log('[WallScanner] Scan completed, walls found:', data.walls?.length || 0);

        set({
          walls: Array.isArray(data.walls) ? data.walls : [],
          loading: false,
          isFetching: false,
          activeAbortController: null,
          lastUpdated: new Date().toISOString(),
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (isRequestCanceled(fetchError)) {
          set({
            loading: false,
            isFetching: false,
            activeAbortController: null,
            ...(didTimeout
              ? { error: 'Scan request timed out. Try a higher minimum order size or lower depth.' }
              : {}),
          });
        } else {
          throw fetchError;
        }
      }
    } catch (error) {
      set({ error: error.message, loading: false, isFetching: false, activeAbortController: null });
    }
  },

  fetchDensity: async (exchange, symbol, minVolume) => {
    const { depth } = get();
    const minVolumeUSD = Number.isFinite(Number(minVolume)) ? Number(minVolume) : 300000;
    try {
      const data = await wallScannerService.getDensityMap(exchange, symbol, depth, minVolumeUSD);
      const key = `${exchange}:${symbol}`;
      set((state) => ({
        densityMaps: { ...state.densityMaps, [key]: data },
        densityMeta: {
          ...state.densityMeta,
          [key]: { depth, minVolume: minVolumeUSD },
        },
      }));
    } catch (error) {
      console.error('Failed to fetch density map:', error);
    }
  },

  startAutoScan: () => {
    const state = get();
    if (state.isRunning) return;

    const id = setInterval(() => {
      get().fetchWalls();
    }, state.scanIntervalSeconds * 1000);

    set({ isRunning: true, intervalId: id });
    get().fetchWalls();
  },

  stopAutoScan: () => {
    const { intervalId, activeAbortController } = get();
    if (intervalId) {
      clearInterval(intervalId);
    }
    if (activeAbortController) {
      activeAbortController.abort();
    }
    set({ isRunning: false, intervalId: null, isFetching: false, activeAbortController: null });
  },

  restartScan: () => {
    const state = get();

    // Clear existing interval
    if (state.intervalId) {
      clearInterval(state.intervalId);
    }

    // Abort current request so new settings apply immediately
    if (state.activeAbortController) {
      state.activeAbortController.abort();
    }

    set({ isFetching: false, activeAbortController: null });

    // Immediate fetch with new settings
    get().fetchWalls();
    state.fetchAllSymbols();

    const id = setInterval(() => {
      get().fetchWalls();
    }, state.scanIntervalSeconds * 1000);

    set({ isRunning: true, intervalId: id });
  },

  exportCSV: () => {
    const { walls } = get();
    if (walls.length === 0) return;

    const headers = ['Timestamp', 'Exchange', 'Symbol', 'Side', 'Price', 'Volume', 'Volume USD', '% from Mid'];
    const rows = walls.map((w) => [
      w.timestamp,
      w.exchange,
      w.symbol,
      w.side,
      w.price,
      w.volume,
      w.volumeUSD,
      w.percentFromMid,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `wall-scanner-${new Date().toISOString().slice(0, 19)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
}));
