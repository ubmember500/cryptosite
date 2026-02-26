const bybitService = require('./bybitService');

const SNAPSHOT_INTERVAL_MS = 10000;
const WINDOW_MS = 5 * 60 * 1000;
const RETENTION_MS = 7 * 60 * 1000;
const STALE_AFTER_MS = 45000;
const MAX_POINTS_PER_SYMBOL = 80;
const MIN_POINTS_IN_WINDOW = 2;

class BybitMarketMapService {
  constructor() {
    this.priceHistoryBySymbol = new Map();
    this.volumeBySymbol = new Map();
    this.natrBySymbol = new Map();
    this.lastTickAt = 0;
    this.lastError = null;
    this.isTicking = false;
    this.timer = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;

    this.tick()
      .then(() => this.seedFromKlines())
      .catch(() => {});

    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, SNAPSHOT_INTERVAL_MS);
  }

  async seedFromKlines() {
    const symbols = Array.from(this.priceHistoryBySymbol.keys());
    if (symbols.length === 0) return;

    const SEED_CONCURRENCY = 20;
    const SEED_LIMIT = 8;

    let seeded = 0;
    const nowTs = Date.now();

    const seedSymbol = async (symbol) => {
      try {
        const klines = await bybitService.fetchKlines(symbol, 'futures', '1m', SEED_LIMIT);
        if (!Array.isArray(klines) || klines.length < 2) return;

        const points = [];
        for (const k of klines) {
          const ts = Number(k.time) * 1000;
          const high = Number(k.high);
          const low = Number(k.low);
          const close = Number(k.close);
          if (!Number.isFinite(ts)) continue;
          if (Number.isFinite(high) && high > 0) points.push({ ts, price: high });
          if (Number.isFinite(low) && low > 0) points.push({ ts: ts + 1, price: low });
          if (Number.isFinite(close) && close > 0) points.push({ ts: ts + 2, price: close });
        }

        if (points.length < 2) return;

        const existing = this.priceHistoryBySymbol.get(symbol) || [];
        const merged = [...points, ...existing].sort((a, b) => a.ts - b.ts);
        this.priceHistoryBySymbol.set(symbol, this.trimHistory(merged, nowTs));
        seeded += 1;
      } catch {
        // Non-fatal
      }
    };

    for (let i = 0; i < symbols.length; i += SEED_CONCURRENCY) {
      await Promise.all(symbols.slice(i, i + SEED_CONCURRENCY).map(seedSymbol));
    }

    console.log(`[BybitMarketMap] Seeded ${seeded}/${symbols.length} symbols from 1m klines`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      const tokens = await bybitService.fetchTokensWithNATR('futures', {
        forceFresh: true,
      });

      const nowTs = Date.now();
      const liveSymbols = new Set();

      for (const token of tokens || []) {
        const symbol = typeof token?.fullSymbol === 'string' ? token.fullSymbol : null;
        if (!symbol) continue;
        liveSymbols.add(symbol);

        const lastPrice = Number(token?.lastPrice);
        const volume24h = Number(token?.volume24h);
        if (Number.isFinite(volume24h)) {
          this.volumeBySymbol.set(symbol, volume24h);
        }

        const natr = Number(token?.natr);
        if (Number.isFinite(natr) && natr >= 0) {
          this.natrBySymbol.set(symbol, natr);
        }

        if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
          continue;
        }

        const existing = this.trimHistory(this.priceHistoryBySymbol.get(symbol), nowTs);
        const last = existing[existing.length - 1];

        const shouldAppendPoint = !last || nowTs - Number(last.ts || 0) >= SNAPSHOT_INTERVAL_MS - 1000;
        if (shouldAppendPoint) {
          existing.push({ ts: nowTs, price: lastPrice });
        } else if (Number(last.price) !== lastPrice) {
          last.price = lastPrice;
          last.ts = nowTs;
        }

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
      this.lastError = error?.message || 'Failed to refresh Bybit market-map snapshots';
    } finally {
      this.isTicking = false;
    }
  }

  trimHistory(history, nowTs) {
    const safe = Array.isArray(history) ? history : [];
    return safe
      .filter((point) => {
        const ts = Number(point?.ts);
        const price = Number(point?.price);
        return Number.isFinite(ts) && Number.isFinite(price) && price > 0 && nowTs - ts <= RETENTION_MS;
      })
      .slice(-MAX_POINTS_PER_SYMBOL);
  }

  computeFiveMinuteNATR(history, nowTs) {
    const safe = Array.isArray(history) ? history : [];
    if (safe.length < MIN_POINTS_IN_WINDOW) return null;

    const windowStartTs = nowTs - WINDOW_MS;
    const inWindow = safe.filter((point) => Number(point?.ts) >= windowStartTs);
    if (inWindow.length < MIN_POINTS_IN_WINDOW) return null;

    const prices = inWindow.map((p) => p.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const last = prices[prices.length - 1];

    if (!Number.isFinite(last) || last <= 0) return null;
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    if (high <= 0 || low <= 0) return null;

    return ((high - low) / last) * 100;
  }

  getRanking({ limit } = {}) {
    this.start();

    const nowTs = Date.now();
    const scoredRows = [];
    const warmupRows = [];
    let scoredCount = 0;

    for (const [symbol, history] of this.priceHistoryBySymbol.entries()) {
      const volume24h = Number(this.volumeBySymbol.get(symbol) || 0);
      const activityScore = this.computeFiveMinuteNATR(history, nowTs);
      const warmup = !Number.isFinite(activityScore);

      const natrFallback = Number(this.natrBySymbol.get(symbol) || 0);
      const finalScore = warmup ? natrFallback : activityScore;

      const row = {
        symbol,
        activityScore: Number(finalScore.toFixed(6)),
        activityMetric: warmup ? 'natr24h_warmup' : 'natr5m',
        volume24h,
        warmup,
      };

      if (!warmup) {
        scoredCount += 1;
        scoredRows.push(row);
      } else {
        warmupRows.push(row);
      }
    }

    const sortDesc = (a, b) => {
      if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
      if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
      return a.symbol.localeCompare(b.symbol);
    };

    scoredRows.sort(sortDesc);
    warmupRows.sort(sortDesc);

    const ranking = [...scoredRows, ...warmupRows];
    const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : ranking.length;
    const rows = ranking.slice(0, max);

    const isStale = !this.lastTickAt || nowTs - this.lastTickAt > STALE_AFTER_MS;
    const warmupRatio = ranking.length > 0 ? scoredCount / ranking.length : 0;

    return {
      rows,
      totalCount: ranking.length,
      scoredCount,
      warmupRatio,
      isStale,
      updatedAt: this.lastTickAt ? new Date(this.lastTickAt).toISOString() : null,
      lastError: this.lastError,
      contract: {
        type: '5m-natr',
        formula: '(highest_5m - lowest_5m) / last_price * 100',
        windowMinutes: 5,
        sampleIntervalMs: SNAPSHOT_INTERVAL_MS,
        minPointsInWindow: MIN_POINTS_IN_WINDOW,
      },
    };
  }
}

module.exports = new BybitMarketMapService();
