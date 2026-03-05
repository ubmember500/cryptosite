/**
 * DensityScannerService — Orchestrates continuous order-book scanning.
 *
 * Runs background scan loops for Binance, Bybit, and OKX (futures + spot).
 * Each exchange+market pair scans independently on its own interval.
 * Results are fed into WallTracker for identity/age tracking.
 * The API layer reads from latestWalls (pre-computed, instant response).
 *
 * @module densityScanner
 */

const { BinanceProxyScanner } = require('./binanceProxyScanner');
const { BybitWsScanner } = require('./bybitWsScanner');
const { OkxFastScanner } = require('./okxFastScanner');
const { WallTracker } = require('./wallTracker');

// Default scan settings (server-wide, not per-user)
const DEFAULT_DEPTH = 5;            // 5% from mid
const DEFAULT_MIN_WALL_SIZE = 50000; // $50K minimum — low threshold, filtering is done per-user request
const DEFAULT_RADIUS = 20;          // group levels within 1% of each other — captures distributed liquidity zones like ASTER

// How often each exchange rescans (milliseconds)
const SCAN_INTERVALS = {
  binance: 15000, // 15s — Vercel proxy (multi-batch, ~2-4s for 640+ symbols)
  bybit:   15000, // 15s — WebSocket, instant memory reads
  okx:     30000, // 30s — REST, scans all symbols
};

// Stagger start delays (ms).
// Binance uses Vercel proxy (no warm-up needed).
// Bybit uses WebSocket (needs 15s to connect + receive data).
// OKX uses REST (start immediately).
const STAGGER_DELAYS = {
  binance_futures: 0,      // 0s — proxy works immediately
  binance_spot:    2000,   // 2s
  bybit_futures:   15000,  // 15s — give WS time to connect
  bybit_spot:      17000,  // 17s
  okx_futures:     4000,   // 4s
  okx_spot:        6000,   // 6s
};

class DensityScannerService {
  constructor() {
    this.wallTracker = new WallTracker();
    this.scanTimers = new Map(); // key → intervalId
    this.running = false;

    // IMPORTANT: Create scanner instances ONCE and reuse across scan cycles.
    //
    // Binance: Vercel proxy scanner. Binance blocks cloud-provider IPs
    //   (REST 418 + WebSocket blocked from Render/AWS). Route through
    //   Vercel serverless functions in Singapore. Multi-batch: splits
    //   640+ symbols into batches of 150, fires all in parallel (~2-4s).
    //
    // Bybit: WebSocket scanner — 500 symbols, instant memory reads.
    //
    // OKX: REST scanner — works fine from all IPs, scans all symbols.
    this.scanners = {
      binance_futures: new BinanceProxyScanner('futures'),
      binance_spot:    new BinanceProxyScanner('spot'),
      bybit_futures:   new BybitWsScanner('futures'),
      bybit_spot:      new BybitWsScanner('spot'),
      okx_futures:     new OkxFastScanner('futures'),
      okx_spot:        new OkxFastScanner('spot'),
    };

    // Per-exchange status tracking
    this.status = {};

    // Initialize status for each exchange+market pair
    for (const exchange of ['binance', 'bybit', 'okx']) {
      for (const market of ['futures', 'spot']) {
        const key = `${exchange}_${market}`;
        this.status[key] = {
          exchange,
          market,
          lastScanAt: null,
          lastScanDurationMs: null,
          symbolCount: 0, // symbols with detected walls (not total scanned)
          wallCount: 0,
          error: null,
          scanning: false,
        };
      }
    }
  }

  /**
   * Start all scan loops. Called once during server bootstrap.
   * Staggered start to avoid simultaneous API bursts.
   * Restores wall state from DB first so wall ages survive restarts.
   */
  async start() {
    if (this.running) {
      console.log('[DensityScanner] Already running');
      return;
    }
    this.running = true;
    console.log('[DensityScanner] Starting density scanner service...');

    // Restore persisted wall state from DB (preserves wall ages across deploys)
    await this.wallTracker.restoreFromDB();
    this.wallTracker.startPersistence();

    // Launch each exchange+market pair with staggered delays
    for (const exchange of ['binance', 'bybit', 'okx']) {
      for (const market of ['futures', 'spot']) {
        const key = `${exchange}_${market}`;
        const staggerDelay = STAGGER_DELAYS[key] || 0;
        const interval = SCAN_INTERVALS[exchange];

        // Staggered initial scan
        setTimeout(() => {
          if (!this.running) return;
          // Run first scan immediately
          this._runScan(exchange, market);
          // Then set up interval
          const timerId = setInterval(() => {
            if (!this.running) return;
            this._runScan(exchange, market);
          }, interval);
          this.scanTimers.set(key, timerId);
        }, staggerDelay);
      }
    }

    console.log('[DensityScanner] All scan loops scheduled');
  }

  /**
   * Stop all scan loops. Called during graceful shutdown.
   */
  stop() {
    this.running = false;
    for (const [key, timerId] of this.scanTimers) {
      clearInterval(timerId);
    }
    this.scanTimers.clear();
    this.wallTracker.stopPersistence();
    // Save one final snapshot before shutting down
    this.wallTracker._saveToDB().catch(() => {});
    console.log('[DensityScanner] Stopped');
  }

  /**
   * Run a single scan for one exchange+market pair.
   * Creates the appropriate scanner, runs it, feeds walls into WallTracker.
   */
  async _runScan(exchange, market) {
    const key = `${exchange}_${market}`;
    const st = this.status[key];

    // Skip if already scanning this exchange+market
    if (st.scanning) {
      console.log(`[DensityScanner] ${key} scan already in progress, skipping`);
      return;
    }

    st.scanning = true;
    st.error = null;
    const startTime = Date.now();

    try {
      const key2 = `${exchange}_${market}`;
      const scanner = this.scanners[key2];
      let walls = await scanner.scanForWalls({
        minVolumeUSD: 0,         // Scan ALL symbols
        minWallSize: DEFAULT_MIN_WALL_SIZE,
        depth: DEFAULT_DEPTH,
        radius: DEFAULT_RADIUS,
      });

      // Count unique symbols that have walls (not total symbols scanned)
      const symbolsWithWalls = new Set(walls.map(w => w.symbol));

      // Feed into wall tracker
      this.wallTracker.processWalls(walls, exchange, market);

      const elapsed = Date.now() - startTime;

      st.lastScanAt = Date.now();
      st.lastScanDurationMs = elapsed;
      st.wallCount = walls.length;
      st.symbolCount = symbolsWithWalls.size;

      console.log(
        `[DensityScanner] ${key}: ✓ ${walls.length} walls from ${symbolsWithWalls.size} symbols in ${elapsed}ms`
      );
    } catch (error) {
      st.error = error.message;
      console.error(`[DensityScanner] ${key}: scan error:`, error.message);
    } finally {
      st.scanning = false;
    }
  }

  // Scanner instances are created once in the constructor and reused.
  // No more _createScanner factory — this preserves caches across cycles.

  /**
   * Get all tracked walls (for the API layer to filter and return).
   * Returns the full array from WallTracker with age data.
   */
  getWalls() {
    return this.wallTracker.getAllWalls();
  }

  /**
   * Get available symbols per exchange+market.
   * This is derived from the tracked walls — we know what symbols we've seen.
   * Returns { binance_futures: ['BTCUSDT', ...], okx_spot: [...], ... }
   */
  getAvailableSymbols() {
    const symbolMap = {};
    for (const wall of this.wallTracker.activeWalls.values()) {
      const key = `${wall.exchange}_${wall.market}`;
      if (!symbolMap[key]) symbolMap[key] = new Set();
      symbolMap[key].add(wall.symbol);
    }

    // Convert sets to sorted arrays
    const result = {};
    for (const [key, set] of Object.entries(symbolMap)) {
      result[key] = [...set].sort();
    }
    return result;
  }

  /**
   * Get scanner status for health monitoring.
   */
  getStatus() {
    return {
      running: this.running,
      exchanges: { ...this.status },
      tracker: this.wallTracker.getStats(),
    };
  }
}

// Singleton instance — only one scanner should run per server process.
// The API controller and server bootstrap both reference this same instance.
const densityScannerService = new DensityScannerService();

module.exports = densityScannerService;
