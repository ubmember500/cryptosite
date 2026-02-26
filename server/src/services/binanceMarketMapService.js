const binanceService = require('./binanceService');
const WebSocket = require('ws');

// Ring-buffer config (live 3-second snapshots for higher real-time precision)
const SNAPSHOT_INTERVAL_MS = 3000;
const WINDOW_MS = 5 * 60 * 1000;
const RECENT_WINDOW_MS = 60 * 1000;
const RETENTION_MS = 7 * 60 * 1000;
const STALE_AFTER_MS = 45000;
const MAX_POINTS_PER_SYMBOL = 180;
const MIN_POINTS_IN_WINDOW = 8;
const MAX_LAST_POINT_AGE_MS = 12000;
const MIN_VOLUME_24H_USDT = 0;
const FULL_SNAPSHOT_REFRESH_MS = 10000;

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
const MIN_LIVE_SCORED = 20;
const WS_TICKER_URL = 'wss://fstream.binance.com/ws/!ticker@arr';
const WS_RECONNECT_BASE_MS = 3000;
const WS_RECONNECT_MAX_MS = 30000;

class BinanceMarketMapService {
  constructor() {
    this.priceHistoryBySymbol = new Map();
    this.volumeBySymbol = new Map();
    this.natrBySymbol = new Map();
    this.lastTickAt = 0;
    this.lastError = null;
    this.isTicking = false;
    this.timer = null;
    this.fullSnapshotTimer = null;
    this.started = false;
    this.ws = null;
    this.wsReconnectTimer = null;
    this.wsReconnectAttempts = 0;
    this.lastWsMessageAt = 0;

    this.onDemandCache = null;
    this.isComputingOnDemand = false;
    this.onDemandError = null;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.startWsStream();
    this.tick().catch(() => {});
    this.timer = setInterval(() => {
      const nowTs = Date.now();
      for (const [symbol, history] of this.priceHistoryBySymbol.entries()) {
        const trimmed = this.trimHistory(history, nowTs);
        if (trimmed.length === 0) {
          this.priceHistoryBySymbol.delete(symbol);
          this.volumeBySymbol.delete(symbol);
          this.natrBySymbol.delete(symbol);
          continue;
        }
        this.priceHistoryBySymbol.set(symbol, trimmed);
      }
    }, SNAPSHOT_INTERVAL_MS);
    this.fullSnapshotTimer = setInterval(() => {
      this.tick().catch(() => {});
    }, FULL_SNAPSHOT_REFRESH_MS);
  }

  stop() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.removeAllListeners(); } catch {}
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.fullSnapshotTimer) { clearInterval(this.fullSnapshotTimer); this.fullSnapshotTimer = null; }
    this.started = false;
  }

  startWsStream() {
    if (!this.started) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(WS_TICKER_URL);
    this.ws = ws;

    ws.on('open', () => {
      this.wsReconnectAttempts = 0;
      this.lastError = null;
      console.log('[BinanceMarketMap] WS ticker stream connected');
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(String(raw));
        this.handleWsTickerPayload(payload);
      } catch (error) {
        this.lastError = error?.message || 'Failed to parse Binance WS payload';
      }
    });

    ws.on('error', (error) => {
      this.lastError = error?.message || 'Binance WS stream error';
      console.warn('[BinanceMarketMap] WS error:', this.lastError);
    });

    ws.on('close', () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      if (this.started) {
        this.scheduleWsReconnect();
      }
    });
  }

  scheduleWsReconnect() {
    if (!this.started) return;
    if (this.wsReconnectTimer) return;

    this.wsReconnectAttempts += 1;
    const delay = Math.min(WS_RECONNECT_BASE_MS * (2 ** Math.max(0, this.wsReconnectAttempts - 1)), WS_RECONNECT_MAX_MS);

    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.startWsStream();
    }, delay);

    console.warn(`[BinanceMarketMap] WS reconnect scheduled in ${delay}ms`);
  }

  handleWsTickerPayload(payload) {
    if (!Array.isArray(payload) || payload.length === 0) return;

    const nowTs = Date.now();
    for (const item of payload) {
      const symbol = typeof item?.s === 'string' ? item.s : null;
      if (!symbol || !symbol.endsWith('USDT')) continue;

      const lastPrice = Number(item?.c);
      const volume24h = Number(item?.q);
      const high24h = Number(item?.h);
      const low24h = Number(item?.l);

      if (Number.isFinite(volume24h) && volume24h > 0) {
        this.volumeBySymbol.set(symbol, volume24h);
      }

      if (Number.isFinite(high24h) && Number.isFinite(low24h) && Number.isFinite(lastPrice) && lastPrice > 0) {
        const instantNatr = ((high24h - low24h) / lastPrice) * 100;
        if (Number.isFinite(instantNatr) && instantNatr > 0) {
          this.natrBySymbol.set(symbol, instantNatr);
        }
      }

      if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;

      const existing = this.trimHistory(this.priceHistoryBySymbol.get(symbol), nowTs);
      const last = existing[existing.length - 1];
      const shouldAppend = !last || nowTs - Number(last.ts || 0) >= SNAPSHOT_INTERVAL_MS - 1000;

      if (shouldAppend) {
        existing.push({ ts: nowTs, price: lastPrice });
      } else {
        // Keep sample timestamp stable within interval; otherwise we'd keep
        // refreshing ts and never accumulate enough points for 5m windows.
        last.price = lastPrice;
      }

      this.priceHistoryBySymbol.set(symbol, existing.slice(-MAX_POINTS_PER_SYMBOL));
    }

    this.lastTickAt = nowTs;
    this.lastWsMessageAt = nowTs;
    this.lastError = null;
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
    const lastPointTs = Number(inWindow[inWindow.length - 1]?.ts || 0);
    if (!Number.isFinite(lastPointTs) || nowTs - lastPointTs > MAX_LAST_POINT_AGE_MS) return null;
    const prices = inWindow.map((p) => p.price);
    const high = Math.max(...prices); const low = Math.min(...prices); const last = prices[prices.length - 1];
    if (!Number.isFinite(last) || last <= 0) return null;
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    if (high <= 0 || low <= 0) return null;
    return ((high - low) / last) * 100;
  }

  computeWindowRangePercent(history, nowTs, windowMs) {
    const safe = Array.isArray(history) ? history : [];
    if (safe.length < 2) return null;
    const inWindow = safe.filter((p) => Number(p?.ts) >= nowTs - windowMs);
    if (inWindow.length < 2) return null;
    const prices = inWindow.map((p) => Number(p?.price)).filter((v) => Number.isFinite(v) && v > 0);
    if (prices.length < 2) return null;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const last = prices[prices.length - 1];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(last) || last <= 0) return null;
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
            const klines = await binanceService.fetchKlines(token.fullSymbol, 'futures', '5m', KLINE_CANDLES, { maxAge: 45000 });
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

      // Fallback: if ALL kline fetches failed (e.g. Render rate-limited by Binance /klines),
      // use 24h NATR (high24h - low24h) / lastPrice from the ticker data.
      // This is already computed in allTokens.natr and is always available.
      // We mark it natr24h_warmup so the client shows a 'Warmup' badge.
      if (klineResults.length === 0) {
        console.warn('[BinanceMarketMap] All kline fetches failed, falling back to 24h NATR from ticker data');
        const fallbackRows = candidates
          .filter((t) => Number.isFinite(Number(t.natr)) && Number(t.natr) > 0)
          .map((t) => ({
            symbol: t.fullSymbol,
            activityScore: Number(Number(t.natr).toFixed(6)),
            activityMetric: 'natr24h_warmup',
            volume24h: Number(t.volume24h) || 0,
            warmup: true,
          }));
        if (fallbackRows.length === 0) throw new Error('No 5m kline data and no 24h NATR fallback available');
        const fallbackCache = {
          rows: fallbackRows, totalCount: fallbackRows.length, scoredCount: 0,
          warmupRatio: 0, computedAt: Date.now(), isStale: false,
          updatedAt: new Date().toISOString(), lastError: 'klines unavailable, using 24h NATR',
          contract: { type: '5m-natr', formula: '(high24h - low24h) / lastPrice * 100 (fallback)', windowMinutes: 1440, sampleIntervalMs: SNAPSHOT_INTERVAL_MS, minPointsInWindow: MIN_POINTS_IN_WINDOW },
        };
        console.log(
          '[BinanceMarketMap] 24h NATR fallback -> top: ' +
          fallbackRows.slice(0, 5).map((r) => `${r.symbol}=${r.activityScore.toFixed(3)}%`).join(', ')
        );
        this.onDemandCache = fallbackCache;
        return fallbackCache;
      }

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
      const volume24h = Number(this.volumeBySymbol.get(symbol) || 0);
      if (!Number.isFinite(volume24h) || volume24h < MIN_VOLUME_24H_USDT) continue;
      const natr = this.computeFiveMinuteNATR(history, nowTs);
      if (!Number.isFinite(natr)) continue;
      const recentRange = this.computeWindowRangePercent(history, nowTs, RECENT_WINDOW_MS);
      scoredRows.push({
        symbol,
        activityScore: Number(natr.toFixed(6)),
        recentActivityScore: Number.isFinite(recentRange) ? Number(recentRange.toFixed(6)) : 0,
        activityMetric: 'natr5m',
        volume24h,
        warmup: false,
      });
    }
    scoredRows.sort((a, b) => {
      if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
      if (b.recentActivityScore !== a.recentActivityScore) return b.recentActivityScore - a.recentActivityScore;
      if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
      return a.symbol.localeCompare(b.symbol);
    });
    return { scoredRows, scoredCount: scoredRows.length };
  }

  async getRanking({ limit } = {}) {
    // Prefer real-time WS-based 5m volatility ranking.
    // Fallback to on-demand kline/24h ranking only when live stream is unavailable.
    this.start();

    const nowTs = Date.now();
    const { scoredRows, scoredCount } = this.getRankingFromBuffer();
    const hasFreshWsFeed = this.lastWsMessageAt > 0 && nowTs - this.lastWsMessageAt <= STALE_AFTER_MS;

    if (hasFreshWsFeed && scoredCount >= MIN_LIVE_SCORED) {
      const scoredSet = new Set(scoredRows.map((row) => row.symbol));
      const monitoredSymbols = new Set([
        ...Array.from(this.volumeBySymbol.keys()),
        ...Array.from(this.natrBySymbol.keys()),
        ...Array.from(this.priceHistoryBySymbol.keys()),
      ]);

      const warmupRows = Array.from(monitoredSymbols)
        .filter((symbol) => !scoredSet.has(symbol))
        .map((symbol) => ({
          symbol,
          activityScore: 0,
          recentActivityScore: 0,
          activityMetric: 'natr24h_warmup',
          volume24h: Number(this.volumeBySymbol.get(symbol) || 0),
          warmup: true,
        }))
        .sort((a, b) => {
          if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
          return a.symbol.localeCompare(b.symbol);
        });

      const rows = [...scoredRows, ...warmupRows];
      const totalCount = rows.length;
      const warmupRatio = totalCount > 0 ? scoredRows.length / totalCount : 0;
      const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : rows.length;
      console.log(
        `[BinanceMarketMap] getRanking -> live ws path, ${scoredRows.length} scored, top: ` +
        scoredRows.slice(0, 3).map((r) => `${r.symbol}=${r.activityScore.toFixed(3)}%`).join(', ')
      );
      return {
        rows: rows.slice(0, max),
        totalCount,
        scoredCount: scoredRows.length,
        warmupRatio,
        isStale: false,
        updatedAt: this.lastTickAt ? new Date(this.lastTickAt).toISOString() : new Date().toISOString(),
        lastError: null,
        contract: {
          type: '5m-natr',
          formula: '(highest_5m - lowest_5m) / last_price * 100',
          windowMinutes: 5,
          sampleIntervalMs: SNAPSHOT_INTERVAL_MS,
          minPointsInWindow: MIN_POINTS_IN_WINDOW,
        },
      };
    }

    const computed = await this.computeOnDemandRanking();
    if (!computed) {
      return {
        rows: [], totalCount: 0, scoredCount: 0, warmupRatio: 0, isStale: true,
        updatedAt: null, lastError: this.onDemandError || 'No data available',
        contract: { type: '5m-natr', formula: '(max_high - min_low) / last_close * 100', windowMinutes: 5, sampleIntervalMs: SNAPSHOT_INTERVAL_MS, minPointsInWindow: MIN_POINTS_IN_WINDOW },
      };
    }

    const { rows, totalCount, warmupRatio, isStale, updatedAt, lastError, contract } = computed;
    const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : rows.length;

    console.log(
      `[BinanceMarketMap] getRanking -> on-demand path, ${rows.length} scored, top: ` +
      rows.slice(0, 3).map((r) => `${r.symbol}=${r.activityScore.toFixed(3)}%`).join(', ')
    );

    return { rows: rows.slice(0, max), totalCount, scoredCount: rows.length, warmupRatio, isStale, updatedAt, lastError, contract };
  }
}

module.exports = new BinanceMarketMapService();
