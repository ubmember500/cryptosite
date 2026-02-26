const binanceService = require('./binanceService');

// Ring-buffer config (live 10-second snapshots for intra-candle precision)
const SNAPSHOT_INTERVAL_MS = 10000;
const WINDOW_MS = 5 * 60 * 1000;
const RETENTION_MS = 7 * 60 * 1000;
const STALE_AFTER_MS = 45000;
const MAX_POINTS_PER_SYMBOL = 80;
const MIN_POINTS_IN_WINDOW = 2;

// On-demand kline ranking config
// Rather than relying on in-memory ring buffers (which are empty on cold starts /
// Render sleep-wake cycles), we compute 5m NATR on-demand from real kline data.
// Approach:
//   1. Fetch all futures tickers (one call) to get every symbol + 24h NATR
//   2. Pick the top CANDIDATE_COUNT by 24h NATR as volatility candidates
//   3. Fetch the last KLINE_CANDLES x 5m klines for each candidate (concurrent)
//   4. Compute 5m NATR = (max_high - min_low) / last_close * 100
//   5. Sort descending, cache for CACHE_TTL_MS
// Result: always accurate, works on first request, no warmup state.
const CACHE_TTL_MS = 30 * 1000;
const CANDIDATE_COUNT = 200;
const KLINE_CANDLES = 3;
const KLINE_CONCURRENCY = 30;
const MIN_LIVE_SCORED = 50;

class BinanceMarketMapService {
  constructor() {
    this.priceHistoryBySymbol = new Map();
    this.volumeBySymbol = new Map();
    this.natrBySymbol = new Map();
    this.lastTickAt = 0;
    this.lastError = null;
    this.isTicking = false;
    this.timer = null;
    this.started = false;

    this.onDemandCache = null;
    this.isComputingOnDemand = false;
    this.onDemandError = null;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.tick().catch(() => {});
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, SNAPSHOT_INTERVAL_MS);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.started = false;
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const tokens = await binanceService.fetchTokensWithNATR('futures', { forceFresh: true });
      const nowTs = Date.now();
      const liveSymbols = new Set();
      for (const token of tokens || []) {
        const symbol = typeof token?.fullSymbol === 'string' ? token.fullSymbol : null;
        if (!symbol) continue;
        liveSymbols.add(symbol);
        const lastPrice = Number(token?.lastPrice);
        const volume24h = Number(token?.volume24h);
        if (Number.isFinite(volume24h)) this.volumeBySymbol.set(symbol, volume24h);
        const natr = Number(token?.natr);
        if (Number.isFinite(natr) && natr > 0) this.natrBySymbol.set(symbol, natr);
        if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;
        const existing = this.trimHistory(this.priceHistoryBySymbol.get(symbol), nowTs);
        const last = existing[existing.length - 1];
        const shouldAppend = !last || nowTs - Number(last.ts || 0) >= SNAPSHOT_INTERVAL_MS - 1000;
        if (shouldAppend) { existing.push({ ts: nowTs, price: lastPrice }); }
        else if (Number(last.price) !== lastPrice) { last.price = lastPrice; last.ts = nowTs; }
        this.priceHistoryBySymbol.set(symbol, existing.slice(-MAX_POINTS_PER_SYMBOL));
      }
      for (const symbol of Array.from(this.priceHistoryBySymbol.keys())) {
        if (!liveSymbols.has(symbol)) {
          this.priceHistoryBySymbol.delete(symbol);
          this.volumeBySymbol.delete(symbol);
          this.natrBySymbol.delete(symbol);
        }
      }
      this.lastTickAt = nowTs;
      this.lastError = null;
    } catch (error) {
      this.lastError = error?.message || 'Failed to refresh Binance market-map snapshots';
    } finally {
      this.isTicking = false;
    }
  }

  trimHistory(history, nowTs) {
    const safe = Array.isArray(history) ? history : [];
    return safe
      .filter((p) => {
        const ts = Number(p?.ts); const price = Number(p?.price);
        return Number.isFinite(ts) && Number.isFinite(price) && price > 0 && nowTs - ts <= RETENTION_MS;
      })
      .slice(-MAX_POINTS_PER_SYMBOL);
  }

  computeFiveMinuteNATR(history, nowTs) {
    const safe = Array.isArray(history) ? history : [];
    if (safe.length < MIN_POINTS_IN_WINDOW) return null;
    const inWindow = safe.filter((p) => Number(p?.ts) >= nowTs - WINDOW_MS);
    if (inWindow.length < MIN_POINTS_IN_WINDOW) return null;
    const prices = inWindow.map((p) => p.price);
    const high = Math.max(...prices); const low = Math.min(...prices); const last = prices[prices.length - 1];
    if (!Number.isFinite(last) || last <= 0) return null;
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    if (high <= 0 || low <= 0) return null;
    return ((high - low) / last) * 100;
  }

  // Computes 5m NATR on-demand from real kline data.
  // Uses top-CANDIDATE_COUNT symbols by 24h NATR as candidates, then fetches
  // their 3x5m klines and computes (max_high - min_low) / last_close * 100.
  // Results cached for CACHE_TTL_MS (30s).
  async computeOnDemandRanking() {
    const nowTs = Date.now();
    if (this.onDemandCache && nowTs - this.onDemandCache.computedAt < CACHE_TTL_MS) {
      return this.onDemandCache;
    }
    if (this.isComputingOnDemand) return this.onDemandCache || null;

    this.isComputingOnDemand = true;
    this.onDemandError = null;
    try {
      const allTokens = await binanceService.fetchTokensWithNATR('futures', { forceFresh: true });
      if (!Array.isArray(allTokens) || allTokens.length === 0) throw new Error('No tokens from Binance');

      const candidates = allTokens
        .filter((t) => {
          const sym = t?.fullSymbol;
          const natr = Number(t?.natr);
          return typeof sym === 'string' && sym.length > 0 && Number.isFinite(natr) && natr > 0;
        })
        .sort((a, b) => Number(b.natr) - Number(a.natr))
        .slice(0, CANDIDATE_COUNT);

      const klineResults = [];
      for (let i = 0; i < candidates.length; i += KLINE_CONCURRENCY) {
        const batch = candidates.slice(i, i + KLINE_CONCURRENCY);
        const results = await Promise.all(batch.map(async (token) => {
          try {
            const klines = await binanceService.fetchKlines(token.fullSymbol, 'futures', '5m', KLINE_CANDLES);
            if (!Array.isArray(klines) || klines.length < 1) return null;
            let maxHigh = -Infinity, minLow = Infinity, lastClose = null;
            for (const k of klines) {
              const h = Number(k.high); const l = Number(k.low); const c = Number(k.close);
              if (Number.isFinite(h) && h > 0) maxHigh = Math.max(maxHigh, h);
              if (Number.isFinite(l) && l > 0) minLow = Math.min(minLow, l);
              if (Number.isFinite(c) && c > 0) lastClose = c;
            }
            if (maxHigh === -Infinity || minLow === Infinity || !lastClose || lastClose <= 0) return null;
            const natr5m = ((maxHigh - minLow) / lastClose) * 100;
            if (!Number.isFinite(natr5m) || natr5m < 0) return null;
            return { symbol: token.fullSymbol, natr5m, volume24h: Number(token.volume24h) || 0 };
          } catch { return null; }
        }));
        klineResults.push(...results.filter(Boolean));
      }

      if (klineResults.length === 0) throw new Error('No 5m kline data returned');

      klineResults.sort((a, b) => {
        if (b.natr5m !== a.natr5m) return b.natr5m - a.natr5m;
        if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
        return a.symbol.localeCompare(b.symbol);
      });

      const rows = klineResults.map((r) => ({
        symbol: r.symbol,
        activityScore: Number(r.natr5m.toFixed(6)),
        activityMetric: 'natr5m_kline',
        volume24h: r.volume24h,
        warmup: false,
      }));

      const cache = {
        rows,
        totalCount: rows.length,
        scoredCount: rows.length,
        warmupRatio: 1,
        computedAt: Date.now(),
        isStale: false,
        updatedAt: new Date().toISOString(),
        lastError: null,
        contract: {
          type: '5m-natr',
          formula: '(max_high_3candles - min_low_3candles) / last_close * 100',
          windowMinutes: 5,
          sampleIntervalMs: SNAPSHOT_INTERVAL_MS,
          minPointsInWindow: MIN_POINTS_IN_WINDOW,
        },
      };

      this.onDemandCache = cache;
      console.log(
        '[BinanceMarketMap] On-demand 5m NATR -> top: ' +
        rows.slice(0, 5).map((r) => `${r.symbol}=${r.activityScore.toFixed(3)}%`).join(', ')
      );
      return cache;
    } catch (error) {
      this.onDemandError = error?.message || 'On-demand ranking failed';
      console.error('[BinanceMarketMap] On-demand error:', this.onDemandError);
      return this.onDemandCache || null;
    } finally {
      this.isComputingOnDemand = false;
    }
  }

  getRankingFromBuffer() {
    const nowTs = Date.now();
    const scoredRows = [];
    for (const [symbol, history] of this.priceHistoryBySymbol.entries()) {
      const natr = this.computeFiveMinuteNATR(history, nowTs);
      if (!Number.isFinite(natr)) continue;
      scoredRows.push({
        symbol,
        activityScore: Number(natr.toFixed(6)),
        activityMetric: 'natr5m',
        volume24h: Number(this.volumeBySymbol.get(symbol) || 0),
        warmup: false,
      });
    }
    scoredRows.sort((a, b) => {
      if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
      if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
      return a.symbol.localeCompare(b.symbol);
    });
    return { scoredRows, scoredCount: scoredRows.length };
  }

  async getRanking({ limit } = {}) {
    this.start();
    const nowTs = Date.now();
    const { scoredRows, scoredCount } = this.getRankingFromBuffer();

    let rows, totalCount, warmupRatio, isStale, updatedAt, lastError, contract;

    if (scoredCount >= MIN_LIVE_SCORED) {
      rows = scoredRows;
      totalCount = scoredRows.length;
      warmupRatio = 1;
      isStale = !this.lastTickAt || nowTs - this.lastTickAt > STALE_AFTER_MS;
      updatedAt = this.lastTickAt ? new Date(this.lastTickAt).toISOString() : null;
      lastError = this.lastError;
      contract = {
        type: '5m-natr',
        formula: '(highest_5m - lowest_5m) / last_price * 100',
        windowMinutes: 5,
        sampleIntervalMs: SNAPSHOT_INTERVAL_MS,
        minPointsInWindow: MIN_POINTS_IN_WINDOW,
      };
    } else {
      const computed = await this.computeOnDemandRanking();
      if (!computed) {
        return {
          rows: [], totalCount: 0, scoredCount: 0, warmupRatio: 0, isStale: true,
          updatedAt: null, lastError: this.onDemandError || 'No data available',
          contract: { type: '5m-natr', formula: '(max_high - min_low) / last_close * 100', windowMinutes: 5, sampleIntervalMs: SNAPSHOT_INTERVAL_MS, minPointsInWindow: MIN_POINTS_IN_WINDOW },
        };
      }
      rows = computed.rows; totalCount = computed.totalCount; warmupRatio = computed.warmupRatio;
      isStale = computed.isStale; updatedAt = computed.updatedAt; lastError = computed.lastError; contract = computed.contract;
    }

    const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : rows.length;
    return { rows: rows.slice(0, max), totalCount, scoredCount: rows.length, warmupRatio, isStale, updatedAt, lastError, contract };
  }
}

module.exports = new BinanceMarketMapService();
