const binanceService = require('./binanceService');

const SNAPSHOT_INTERVAL_MS = 10000;
const WINDOW_MS = 5 * 60 * 1000;
const RETENTION_MS = 7 * 60 * 1000;
const STALE_AFTER_MS = 45000;
const MAX_POINTS_PER_SYMBOL = 80;
const MIN_POINTS_IN_WINDOW = 2;
const MAX_POINT_GAP_MS = 120000;

class BinanceMarketMapService {
  constructor() {
    this.priceHistoryBySymbol = new Map();
    this.volumeBySymbol = new Map();
    this.natrBySymbol = new Map(); // instant NATR from 24h high/low — used as fallback score during warmup
    this.lastTickAt = 0;
    this.lastError = null;
    this.isTicking = false;
    this.timer = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;

    // First tick builds the symbol list, then immediately seed ring buffers
    // from 1m kline history so rankings have real scores on the first request
    // instead of sitting in warmup for 5+ minutes after every server restart.
    this.tick()
      .then(() => this.seedFromKlines())
      .catch(() => {});

    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, SNAPSHOT_INTERVAL_MS);
  }

  // Retroactively populate ring buffers from the last 8 closed 1m candles
  // (~7 minutes of history). Each candle close becomes a price snapshot point,
  // giving computeFiveMinuteAbsChangePercent() enough data to score immediately.
  async seedFromKlines() {
    const symbols = Array.from(this.priceHistoryBySymbol.keys());
    if (symbols.length === 0) return;

    const SEED_CONCURRENCY = 20;
    const SEED_LIMIT = 8; // 8 × 1m ≈ 7 min — enough to span a 5m window

    let seeded = 0;
    const nowTs = Date.now();

    const seedSymbol = async (symbol) => {
      try {
        const klines = await binanceService.fetchKlines(symbol, 'futures', '1m', SEED_LIMIT);
        if (!Array.isArray(klines) || klines.length < 2) return;

        const points = klines
          .map((k) => ({ ts: Number(k.time) * 1000, price: Number(k.close) }))
          .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.price) && p.price > 0);

        if (points.length < 2) return;

        const existing = this.priceHistoryBySymbol.get(symbol) || [];
        const existingTs = new Set(existing.map((p) => Number(p.ts)));
        const merged = [...points.filter((p) => !existingTs.has(p.ts)), ...existing]
          .sort((a, b) => a.ts - b.ts);

        this.priceHistoryBySymbol.set(symbol, this.trimHistory(merged, nowTs));
        seeded += 1;
      } catch {
        // Non-fatal — symbol warms up naturally on the next tick
      }
    };

    for (let i = 0; i < symbols.length; i += SEED_CONCURRENCY) {
      await Promise.all(symbols.slice(i, i + SEED_CONCURRENCY).map(seedSymbol));
    }

    console.log(`[BinanceMarketMap] Seeded ${seeded}/${symbols.length} symbols from 1m klines — rankings live immediately`);
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
      const tokens = await binanceService.fetchTokensWithNATR('futures', {
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
      this.lastError = error?.message || 'Failed to refresh Binance market-map snapshots';
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

  computeFiveMinuteAbsChangePercent(history, nowTs) {
    const safe = Array.isArray(history) ? history : [];
    if (safe.length < 2) return null;

    const windowStartTs = nowTs - WINDOW_MS;
    const inWindow = safe.filter((point) => Number(point?.ts) >= windowStartTs);
    if (inWindow.length < MIN_POINTS_IN_WINDOW) return null;

    for (let index = 1; index < inWindow.length; index += 1) {
      const gap = Number(inWindow[index].ts) - Number(inWindow[index - 1].ts);
      if (!Number.isFinite(gap) || gap > MAX_POINT_GAP_MS) {
        return null;
      }
    }

    const close = Number(inWindow[inWindow.length - 1]?.price);
    const reference = Number(inWindow[0]?.price);
    if (!Number.isFinite(close) || close <= 0) return null;
    if (!Number.isFinite(reference) || reference <= 0) return null;

    return Math.abs(((close - reference) / reference) * 100);
  }

  getRanking({ limit } = {}) {
    this.start();

    const nowTs = Date.now();
    const scoredRows = [];
    const warmupRows = [];
    let scoredCount = 0;

    for (const [symbol, history] of this.priceHistoryBySymbol.entries()) {
      const volume24h = Number(this.volumeBySymbol.get(symbol) || 0);
      const activityScore = this.computeFiveMinuteAbsChangePercent(history, nowTs);
      const warmup = !Number.isFinite(activityScore);

      // During warmup use instant NATR (24h high-low/price) as proxy score so
      // volatile coins rank above liquid-but-quiet large-caps like BTC/ETH/SOL.
      const natrFallback = Number(this.natrBySymbol.get(symbol) || 0);
      const finalScore = warmup ? natrFallback : activityScore;

      const row = {
        symbol,
        activityScore: Number(finalScore.toFixed(6)),
        activityMetric: 'change5m',
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

    scoredRows.sort((a, b) => {
      if (b.activityScore !== a.activityScore) {
        return b.activityScore - a.activityScore;
      }

      if (b.volume24h !== a.volume24h) {
        return b.volume24h - a.volume24h;
      }

      return a.symbol.localeCompare(b.symbol);
    });

    // Sort warmup rows by NATR proxy score desc so volatile coins appear first
    // even before the 5m ring-buffer has enough history for true scoring.
    warmupRows.sort((a, b) => {
      if (b.activityScore !== a.activityScore) {
        return b.activityScore - a.activityScore;
      }

      if (b.volume24h !== a.volume24h) {
        return b.volume24h - a.volume24h;
      }

      return a.symbol.localeCompare(b.symbol);
    });

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
        type: '5m-absolute-change-percent',
        formula: 'abs((close_now - close_5m_ago) / close_5m_ago) * 100',
        windowMinutes: 5,
        sampleIntervalMs: SNAPSHOT_INTERVAL_MS,
        minPointsInWindow: MIN_POINTS_IN_WINDOW,
      },
    };
  }
}

module.exports = new BinanceMarketMapService();
