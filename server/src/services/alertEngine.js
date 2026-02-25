const cron = require('node-cron');
const prisma = require('../utils/prisma');
const binanceService = require('./binanceService');
const bybitService = require('./bybitService');
const okxService = require('./okxService');
const gateService = require('./gateService');
const mexcService = require('./mexcService');
const bitgetService = require('./bitgetService');
const socketService = require('./socketService');
const telegramService = require('./telegramService');
const { processPriceAlerts } = require('./priceAlertEngine');
const priceWatcher = require('./priceWatcher');

let alertEngineRunning = false;
let alertEngineShuttingDown = false;
let engineWorkerActive = false;
let alertCheckInProgress = false;
let fastPriceCheckInProgress = false;
let fastPriceTimer = null;
let complexCronTask = null;
let leaseCoordinatorTimer = null;
let leaseOpInProgress = false;

// ─── Complex alert in-memory cache ─────────────────────────────────────────
// Pre-parsed active complex alerts. Refreshed every 30s + on alert CRUD.
// Each entry: { id, userId, name, description, exchange, market,
//               alertForMode, symbolSet (Set), threshold, timeframeSec }
let complexAlertsCache = [];
let complexCacheRefreshedAt = 0;
let complexCacheRefreshTimer = null;
const COMPLEX_CACHE_REFRESH_MS = 30_000;
const COMPLEX_HISTORY_LOOKBACK_SEC = 65; // slightly more than 60s window

// Set of 'exchange|market' that have active complex alerts (for tick filter)
let activeComplexExchangeMarkets = new Set();

const ENGINE_INSTANCE_ID = process.env.ALERT_ENGINE_INSTANCE_ID || `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
const LEASE_TABLE = '"EngineLease"';
const LEASE_NAME = process.env.ALERT_ENGINE_LEASE_NAME || 'price-alert-engine';
const LEASE_TTL_MS = Math.max(5000, Number(process.env.ALERT_ENGINE_LEASE_TTL_MS || 15000));
const LEASE_HEARTBEAT_MS = Math.max(1000, Number(process.env.ALERT_ENGINE_LEASE_HEARTBEAT_MS || Math.floor(LEASE_TTL_MS / 3)));
const LEASE_RETRY_MS = Math.max(1000, Number(process.env.ALERT_ENGINE_LEASE_RETRY_MS || 2000));
const LEASE_ENABLED = String(process.env.ALERT_ENGINE_SINGLE_WORKER || '').toLowerCase() === 'true' || process.env.NODE_ENV === 'production';

let leaseOwner = false;

const engineCounters = {
  leaseClaimAttempt: 0,
  leaseClaimSuccess: 0,
  leaseClaimMiss: 0,
  leaseRenewSuccess: 0,
  leaseRenewFail: 0,
  leaseRelease: 0,
  evaluateRuns: 0,
  evaluateSkippedReentry: 0,
  priceRuns: 0,
  priceSkippedReentry: 0,
  triggersPrice: 0,
  triggersComplex: 0,
  transientErrors: 0,
};

const FAST_PRICE_ALERT_INTERVAL_MS = Math.max(150, Number(process.env.PRICE_ALERT_POLL_MS || 300));

function nowIso() {
  return new Date().toISOString();
}

function logEngine(level, event, fields = {}) {
  const payload = {
    scope: 'alertEngine',
    event,
    level,
    ts: nowIso(),
    instanceId: ENGINE_INSTANCE_ID,
    leaseEnabled: LEASE_ENABLED,
    leaseOwner,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

async function ensureLeaseTable() {
  if (!LEASE_ENABLED) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${LEASE_TABLE} (
      "name" TEXT PRIMARY KEY,
      "ownerId" TEXT NOT NULL,
      "acquiredAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "renewedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "meta" JSONB
    )`
  );
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EngineLease_expiresAt_idx" ON ${LEASE_TABLE}("expiresAt")`);
}

async function claimLease() {
  if (!LEASE_ENABLED) {
    leaseOwner = true;
    return true;
  }

  engineCounters.leaseClaimAttempt += 1;
  const ttlSeconds = LEASE_TTL_MS / 1000;
  const result = await prisma.$queryRawUnsafe(
    `INSERT INTO ${LEASE_TABLE} ("name", "ownerId", "acquiredAt", "renewedAt", "expiresAt", "meta")
     VALUES ($1, $2, NOW(), NOW(), NOW() + ($3 * INTERVAL '1 second'), $4::jsonb)
     ON CONFLICT ("name") DO UPDATE
       SET "ownerId" = EXCLUDED."ownerId",
           "renewedAt" = NOW(),
           "expiresAt" = NOW() + ($3 * INTERVAL '1 second'),
           "meta" = EXCLUDED."meta"
     WHERE ${LEASE_TABLE}."expiresAt" <= NOW() OR ${LEASE_TABLE}."ownerId" = EXCLUDED."ownerId"
     RETURNING "ownerId", "expiresAt"`,
    LEASE_NAME,
    ENGINE_INSTANCE_ID,
    ttlSeconds,
    JSON.stringify({ pid: process.pid, host: process.env.HOSTNAME || null, at: nowIso() })
  );

  const acquired = Array.isArray(result) && result.length > 0 && result[0].ownerId === ENGINE_INSTANCE_ID;
  leaseOwner = acquired;

  if (acquired) {
    engineCounters.leaseClaimSuccess += 1;
    logEngine('info', 'lease.claim.success', { leaseName: LEASE_NAME, expiresAt: result[0].expiresAt });
    return true;
  }

  engineCounters.leaseClaimMiss += 1;
  logEngine('info', 'lease.claim.miss', { leaseName: LEASE_NAME });
  return false;
}

async function renewLease() {
  if (!LEASE_ENABLED) return true;
  if (!leaseOwner) return false;

  const ttlSeconds = LEASE_TTL_MS / 1000;
  const result = await prisma.$queryRawUnsafe(
    `UPDATE ${LEASE_TABLE}
     SET "renewedAt" = NOW(),
         "expiresAt" = NOW() + ($3 * INTERVAL '1 second'),
         "meta" = $4::jsonb
     WHERE "name" = $1
       AND "ownerId" = $2
       AND "expiresAt" > NOW()
     RETURNING "expiresAt"`,
    LEASE_NAME,
    ENGINE_INSTANCE_ID,
    ttlSeconds,
    JSON.stringify({ pid: process.pid, host: process.env.HOSTNAME || null, at: nowIso() })
  );

  const renewed = Array.isArray(result) && result.length > 0;
  if (renewed) {
    engineCounters.leaseRenewSuccess += 1;
    logEngine('info', 'lease.renew.success', { leaseName: LEASE_NAME, expiresAt: result[0].expiresAt });
    return true;
  }

  engineCounters.leaseRenewFail += 1;
  leaseOwner = false;
  logEngine('warn', 'lease.renew.lost', { leaseName: LEASE_NAME });
  return false;
}

async function releaseLease(reason = 'shutdown') {
  if (!LEASE_ENABLED || !leaseOwner) return;
  await prisma.$executeRawUnsafe(
    `DELETE FROM ${LEASE_TABLE} WHERE "name" = $1 AND "ownerId" = $2`,
    LEASE_NAME,
    ENGINE_INSTANCE_ID
  );
  leaseOwner = false;
  engineCounters.leaseRelease += 1;
  logEngine('info', 'lease.release', { leaseName: LEASE_NAME, reason });
}

/**
 * Refresh in-memory cache of active complex alerts from DB.
 * Called every 30s and after any alert CRUD operation.
 */
async function refreshComplexAlertsCache() {
  try {
    const alerts = await prisma.alert.findMany({
      where: { isActive: true, alertType: 'complex' },
    });

    const newCache = [];
    for (const a of alerts) {
      const notifOpts = parseNotificationOptions(a.notificationOptions);
      const alertForMode = notifOpts.alertForMode || 'all';
      const conds = parseConditions(a.conditions);
      const cond = conds.find((c) => c?.type === 'pct_change');
      if (!cond) continue;

      const threshold = Math.abs(Number(cond.value));
      const timeframeSec = parseTimeframeSeconds(cond.timeframe);
      if (!Number.isFinite(threshold) || threshold <= 0) continue;
      if (!Number.isFinite(timeframeSec) || timeframeSec <= 0) continue;

      const rawSymbols = parseSymbols(a.symbols);
      const symbolSet = new Set(
        rawSymbols.map((s) => {
          const up = String(s || '').toUpperCase().trim();
          if (!up) return '';
          if (!up.endsWith('USDT') && !up.endsWith('USD') && !up.includes('/')) return up + 'USDT';
          return up;
        }).filter(Boolean)
      );

      newCache.push({
        id: a.id,
        userId: a.userId,
        name: a.name,
        description: a.description ?? null,
        exchange: (a.exchange || 'binance').toLowerCase(),
        market: (a.market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures',
        alertForMode,
        symbolSet,
        threshold,
        timeframeSec,
      });
    }

    complexAlertsCache = newCache;
    complexCacheRefreshedAt = Date.now();
    activeComplexExchangeMarkets = new Set(newCache.map((a) => `${a.exchange}|${a.market}`));

    logEngine('info', 'complex.cache.refresh', {
      count: newCache.length,
      exchangeMarkets: Array.from(activeComplexExchangeMarkets),
    });
  } catch (err) {
    logEngine('error', 'complex.cache.refresh.error', { message: err?.message || String(err) });
  }
}

/**
 * Fire a complex alert trigger asynchronously (non-blocking from tick handler).
 * Does a final cooldown check to handle races between rapid ticks.
 */
async function fireTriggerAsync(alert, symbol, stats, spanPct, nowMs) {
  try {
    // Double-check cooldown — multiple ticks may have queued this concurrently
    if (!canEmitComplexTrigger(alert.id, symbol, nowMs)) return;
    markComplexTrigger(alert.id, symbol, nowMs);

    const updatedAlert = await prisma.alert.update({
      where: { id: alert.id },
      data: {
        triggered: true,
        triggeredAt: new Date(),
        isActive: true, // Keep active — complex alerts monitor continuously
      },
    });

    const direction = stats.current >= stats.oldest ? 1 : -1;
    const reportedPct = direction * spanPct;

    const payload = {
      id: updatedAlert.id,
      alertId: updatedAlert.id,
      name: updatedAlert.name,
      description: updatedAlert.description ?? null,
      triggered: true,
      triggeredAt: updatedAlert.triggeredAt,
      alertType: 'complex',
      symbol,
      pctChange: reportedPct,
      baselinePrice: direction >= 0 ? stats.min : stats.max,
      currentPrice: direction >= 0 ? stats.max : stats.min,
      windowSeconds: alert.timeframeSec,
    };

    socketService.emitAlertTriggered(updatedAlert.userId, payload);
    await sendAlertToTelegram(updatedAlert.userId, payload);
    engineCounters.triggersComplex += 1;

    logEngine('info', 'trigger.complex', {
      alertId: updatedAlert.id,
      userId: updatedAlert.userId,
      symbol,
      spanPct: Number(spanPct.toFixed(4)),
      threshold: alert.threshold,
      timeframeSec: alert.timeframeSec,
    });
    console.log(
      `⚡⚡⚡ Complex alert ${alert.id} TRIGGERED: ${symbol} ` +
      `span=${spanPct.toFixed(2)}% (threshold=${alert.threshold}%) in ${alert.timeframeSec}s | ` +
      `oldest=${stats.oldest.toFixed(6)} current=${stats.current.toFixed(6)}`
    );
  } catch (err) {
    logEngine('error', 'trigger.complex.fire.error', {
      alertId: alert.id,
      symbol,
      message: err?.message || String(err),
    });
  }
}

/**
 * Tick-driven complex alert handler — called on EVERY WS message from priceWatcher.
 *
 * Flow:
 *   1. Append incoming prices to rolling 65-second history.
 *   2. For every symbol in this tick, check each cached complex alert.
 *   3. If price window span >= threshold → fire trigger immediately (setImmediate).
 *
 * This replaces the old 1-second cron evaluation, allowing sub-second detection.
 */
let complexTickCount = 0;
let complexTickLogTs = 0;

function handlePriceTick({ exchange, market, prices: tickPrices }) {
  if (!tickPrices || typeof tickPrices !== 'object') return;
  const key = `${exchange}|${market}`;

  // Only store history if there are active complex alerts for this exchange+market
  if (!activeComplexExchangeMarkets.has(key)) return;

  const nowMs = Date.now();
  appendComplexPricePoints(exchange, market, tickPrices, nowMs, COMPLEX_HISTORY_LOOKBACK_SEC);

  complexTickCount += 1;
  if (nowMs - complexTickLogTs >= 30_000) {
    const historyMap = getHistoryMapForExchangeMarket(exchange, market);
    console.log(
      `[alertEngine] Ticks: ${complexTickCount} | cache: ${complexAlertsCache.length} alerts | ` +
      `${key}: ${historyMap?.size || 0} symbols tracked`
    );
    complexTickLogTs = nowMs;
  }

  // Get alerts relevant to this exchange+market
  const relevantAlerts = complexAlertsCache.filter(
    (a) => a.exchange === exchange && a.market === market
  );
  if (relevantAlerts.length === 0) return;

  const historyMap = getHistoryMapForExchangeMarket(exchange, market);

  for (const rawSym of Object.keys(tickPrices)) {
    const symbolUpper = String(rawSym || '').toUpperCase();
    if (!symbolUpper) continue;

    // Resolve symbol key as stored in history (with or without .P suffix)
    let resolvedSymbol = symbolUpper;
    if (!historyMap.has(symbolUpper)) {
      if (market === 'futures' && symbolUpper.endsWith('USDT')) {
        const withP = symbolUpper + '.P';
        if (historyMap.has(withP)) resolvedSymbol = withP;
      } else if (symbolUpper.endsWith('.P')) {
        const noP = symbolUpper.slice(0, -2);
        if (historyMap.has(noP)) resolvedSymbol = noP;
      }
    }

    for (const alert of relevantAlerts) {
      // Scope filter
      if (alert.alertForMode === 'whitelist') {
        // Match symbols with or without .P suffix (futures symbols may have either form)
        const bareSymbol = resolvedSymbol.replace(/\.P$/, '');
        if (
          !alert.symbolSet.has(resolvedSymbol) &&
          !alert.symbolSet.has(symbolUpper) &&
          !alert.symbolSet.has(bareSymbol) &&
          !alert.symbolSet.has(bareSymbol + '.P')
        ) continue;
      } else {
        // 'all' mode: only USDT pairs (skip .P suffixed and non-USDT)
        const bare = resolvedSymbol.replace(/\.P$/, '');
        if (!bare.endsWith('USDT')) continue;
      }

      // Quick cooldown check before expensive window stats
      if (!canEmitComplexTrigger(alert.id, resolvedSymbol, nowMs)) continue;

      const stats = getWindowStats(exchange, market, resolvedSymbol, nowMs, alert.timeframeSec);
      if (!stats) continue;

      const spanPct = ((stats.max - stats.min) / stats.min) * 100;
      if (spanPct < alert.threshold) continue;

      // Trigger — fire async to avoid blocking tick processing
      const alertSnap = { ...alert };
      const statsSnap = { ...stats };
      setImmediate(() => fireTriggerAsync(alertSnap, resolvedSymbol, statsSnap, spanPct, nowMs));
    }
  }
}

// ─── Complex alert loop (independent of lease system) ────────────────────
let complexLoopActive = false;
let complexSweepTimer = null;
const COMPLEX_SWEEP_INTERVAL_MS = 10_000; // 10-second safety-net sweep

/**
 * Seed price history from priceWatcher's in-memory price maps.
 * Called once on startup / after cold start to give the engine at least 1 data
 * point per symbol immediately, so the very FIRST WS tick already has a
 * baseline to compare against (via the bridge in getWindowStats).
 */
function seedHistoryFromPriceMaps() {
  const nowMs = Date.now();
  let seeded = 0;
  for (const exKey of activeComplexExchangeMarkets) {
    const [exchange, market] = exKey.split('|');
    const priceMap = priceWatcher.getPriceMap(exchange, market);
    if (priceMap && typeof priceMap === 'object') {
      const count = Object.keys(priceMap).length;
      if (count > 0) {
        appendComplexPricePoints(exchange, market, priceMap, nowMs, COMPLEX_HISTORY_LOOKBACK_SEC);
        seeded += count;
      }
    }
  }
  if (seeded > 0) {
    logEngine('info', 'complex.history.seeded', { symbols: seeded });
  }
}

/**
 * Periodic safety-net: iterate over ALL symbols in the history maps and
 * evaluate them against cached complex alerts.  Catches moves that the
 * per-tick handler may have missed due to timing, dropped WS msgs, or
 * edge-of-window threshold crossings caused by time advancing.
 */
function sweepAllComplexSymbols() {
  if (!complexLoopActive || complexAlertsCache.length === 0) return;
  const nowMs = Date.now();

  for (const exKey of activeComplexExchangeMarkets) {
    const [exchange, market] = exKey.split('|');
    const relevantAlerts = complexAlertsCache.filter(
      (a) => a.exchange === exchange && a.market === market,
    );
    if (relevantAlerts.length === 0) continue;

    const historyMap = getHistoryMapForExchangeMarket(exchange, market);

    for (const [symbol] of historyMap) {
      for (const alert of relevantAlerts) {
        // Scope filter (same logic as handlePriceTick)
        if (alert.alertForMode === 'whitelist') {
          const bareSymbol = symbol.replace(/\.P$/, '');
          if (
            !alert.symbolSet.has(symbol) &&
            !alert.symbolSet.has(bareSymbol) &&
            !alert.symbolSet.has(bareSymbol + '.P')
          ) continue;
        } else {
          const bare = symbol.replace(/\.P$/, '');
          if (!bare.endsWith('USDT')) continue;
        }

        if (!canEmitComplexTrigger(alert.id, symbol, nowMs)) continue;

        const stats = getWindowStats(exchange, market, symbol, nowMs, alert.timeframeSec);
        if (!stats) continue;

        const spanPct = ((stats.max - stats.min) / stats.min) * 100;
        if (spanPct < alert.threshold) continue;

        const alertSnap = { ...alert };
        const statsSnap = { ...stats };
        setImmediate(() => fireTriggerAsync(alertSnap, symbol, statsSnap, spanPct, nowMs));
      }
    }
  }
}

function startComplexLoop() {
  if (complexLoopActive) return;
  priceWatcher.onTick(handlePriceTick);

  // Refresh cache first, then seed history from priceWatcher's in-memory maps
  // so the very first WS tick can immediately compare against a baseline price.
  refreshComplexAlertsCache()
    .then(() => seedHistoryFromPriceMaps())
    .catch((err) => logEngine('error', 'complex.seed.error', { message: err?.message || String(err) }));

  complexCacheRefreshTimer = setInterval(() => refreshComplexAlertsCache(), COMPLEX_CACHE_REFRESH_MS);

  // Safety-net sweep — catches threshold crossings that the per-tick handler missed
  complexSweepTimer = setInterval(sweepAllComplexSymbols, COMPLEX_SWEEP_INTERVAL_MS);

  complexLoopActive = true;
  logEngine('info', 'complex.loop.start');
}

function stopComplexLoop() {
  if (!complexLoopActive) return;
  priceWatcher.offTick(handlePriceTick);
  if (complexCacheRefreshTimer) {
    clearInterval(complexCacheRefreshTimer);
    complexCacheRefreshTimer = null;
  }
  if (complexSweepTimer) {
    clearInterval(complexSweepTimer);
    complexSweepTimer = null;
  }
  complexAlertsCache = [];
  activeComplexExchangeMarkets = new Set();
  complexLoopActive = false;
  logEngine('info', 'complex.loop.stop');
}

function startWorkerLoops() {
  if (engineWorkerActive) return;
  fastPriceTimer = setInterval(() => {
    checkPriceAlertsFast();
  }, FAST_PRICE_ALERT_INTERVAL_MS);
  klinesSweepTimer = setInterval(() => {
    runKlinesSweep();
  }, KLINES_SWEEP_INTERVAL_MS);
  // Cron handles price alerts only; complex alerts are tick-driven via startComplexLoop
  complexCronTask = cron.schedule('* * * * * *', () => checkAlerts());
  checkPriceAlertsFast();
  checkAlerts();
  // First klines sweep after a 30s delay to let caches warm up
  setTimeout(() => runKlinesSweep(), 30_000);
  engineWorkerActive = true;
  logEngine('info', 'worker.start', { fastIntervalMs: FAST_PRICE_ALERT_INTERVAL_MS, klinesSweepIntervalMs: KLINES_SWEEP_INTERVAL_MS });
}

function stopWorkerLoops(reason = 'manual') {
  if (fastPriceTimer) {
    clearInterval(fastPriceTimer);
    fastPriceTimer = null;
  }
  if (klinesSweepTimer) {
    clearInterval(klinesSweepTimer);
    klinesSweepTimer = null;
  }
  if (complexCronTask) {
    complexCronTask.stop();
    complexCronTask = null;
  }
  if (engineWorkerActive) {
    logEngine('info', 'worker.stop', { reason });
  }
  engineWorkerActive = false;
  // NOTE: Complex alert loop NOT stopped here — it runs independent of lease
}

async function waitForInFlightChecks(maxWaitMs = 5000) {
  const startedAt = Date.now();
  while ((alertCheckInProgress || fastPriceCheckInProgress) && Date.now() - startedAt < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function runLeaseCoordinatorTick(trigger) {
  if (!alertEngineRunning || alertEngineShuttingDown || leaseOpInProgress) {
    return;
  }

  leaseOpInProgress = true;
  try {
    if (!LEASE_ENABLED) {
      if (!engineWorkerActive) startWorkerLoops();
      return;
    }

    if (leaseOwner) {
      const renewed = await renewLease();
      if (!renewed) {
        stopWorkerLoops('lease-lost');
      }
      return;
    }

    const claimed = await claimLease();
    if (claimed) {
      startWorkerLoops();
    } else {
      stopWorkerLoops('standby');
    }
  } catch (error) {
    engineCounters.transientErrors += 1;
    logEngine('error', 'lease.coordinator.error', {
      trigger,
      message: error?.message || String(error),
    });
  } finally {
    leaseOpInProgress = false;
  }
}

// Store initial prices for pct_change alerts (alertId -> initialPrice). Kept for backward compat.
const initialPrices = new Map();

function setInitialPrice(alertId, initialPrice) {
  initialPrices.set(alertId, initialPrice);
}

function clearInitialPrice(alertId) {
  initialPrices.delete(alertId);
}

// Complex alert runtime: price history per exchange + market (so exchanges don't mix)
// complexPriceHistory[exchange][market] = Map(symbol -> [{ ts, price }])
const complexPriceHistory = {
  binance: { futures: new Map(), spot: new Map() },
  bybit: { futures: new Map(), spot: new Map() },
  okx: { futures: new Map(), spot: new Map() },
  gate: { futures: new Map(), spot: new Map() },
  mexc: { futures: new Map(), spot: new Map() },
  bitget: { futures: new Map(), spot: new Map() },
};
const complexLastTrigger = new Map(); // alertId -> Map(symbol -> ts)

function getExchangeKey(exchange) {
  const ex = (exchange || 'binance').toLowerCase();
  if (!complexPriceHistory[ex]) complexPriceHistory[ex] = { futures: new Map(), spot: new Map() };
  return ex;
}

function getHistoryMapForExchangeMarket(exchange, market) {
  const ex = getExchangeKey(exchange);
  return market === 'spot' ? complexPriceHistory[ex].spot : complexPriceHistory[ex].futures;
}

function appendComplexPricePoints(exchange, market, priceMap, nowMs, keepSec) {
  const historyMap = getHistoryMapForExchangeMarket(exchange, market);
  const cutoff = nowMs - (keepSec * 1000 + 5000); // small buffer

  for (const [rawSymbol, rawPrice] of Object.entries(priceMap || {})) {
    const symbol = String(rawSymbol || '').toUpperCase();
    const price = Number(rawPrice);
    if (!symbol || !Number.isFinite(price) || price <= 0) continue;

    const arr = historyMap.get(symbol) || [];
    arr.push({ ts: nowMs, price });

    let idx = 0;
    while (idx < arr.length && arr[idx].ts < cutoff) idx += 1;
    if (idx > 0) arr.splice(0, idx);

    historyMap.set(symbol, arr);
  }
}

function getWindowStats(exchange, market, symbol, nowMs, lookbackSec) {
  const historyMap = getHistoryMapForExchangeMarket(exchange, market);
  const arr = historyMap.get(String(symbol || '').toUpperCase());
  if (!arr || arr.length < 2) return null;

  const cutoff = nowMs - lookbackSec * 1000;

  // Track the most recent pre-cutoff point as a "bridge" baseline.
  // This lets us detect moves that started just before the current window,
  // which is critical after WS reconnects or data gaps.
  let bridgePoint = null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let oldest = null;
  let current = null;
  let points = 0;

  for (let i = 0; i < arr.length; i += 1) {
    const p = arr[i];
    if (!Number.isFinite(p.price) || p.price <= 0) continue;
    if (p.ts < cutoff) {
      bridgePoint = p; // keep updating — last one before cutoff wins
      continue;
    }
    if (oldest == null) oldest = p.price;
    if (p.price < min) min = p.price;
    if (p.price > max) max = p.price;
    current = p.price;
    points += 1;
  }

  // If insufficient in-window points but we have a bridge point, include it
  // as the baseline so we can detect moves that span the window boundary.
  if (points < 2 && bridgePoint) {
    if (oldest == null) oldest = bridgePoint.price;
    if (bridgePoint.price < min) min = bridgePoint.price;
    if (bridgePoint.price > max) max = bridgePoint.price;
    if (current == null) current = bridgePoint.price;
    points += 1;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || points < 2 || current == null || oldest == null) {
    return null;
  }

  return { min, max, oldest, current, points };
}

function canEmitComplexTrigger(alertId, symbol, nowMs, cooldownMs = 30000) {
  const bySymbol = complexLastTrigger.get(alertId);
  if (!bySymbol) return true;
  const lastTs = bySymbol.get(String(symbol || '').toUpperCase());
  if (!lastTs) return true;
  return nowMs - lastTs >= cooldownMs;
}

function markComplexTrigger(alertId, symbol, nowMs) {
  if (!complexLastTrigger.has(alertId)) {
    complexLastTrigger.set(alertId, new Map());
  }
  complexLastTrigger.get(alertId).set(String(symbol || '').toUpperCase(), nowMs);
}

/** Format seconds as human-readable timeframe for Telegram message. */
function formatTimeframeLabel(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m} minute${m !== 1 ? 's' : ''}`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    return `${h} hour${h !== 1 ? 's' : ''}`;
  }
  const d = Math.floor(seconds / 86400);
  return `${d} day${d !== 1 ? 's' : ''}`;
}

/** Strip USDT/USD suffix for shorter coin display. */
function shortSymbol(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/USDT$/i, '').replace(/USD$/i, '').trim() || s;
}

/**
 * Format alert payload into a short message for Telegram: (1) alert name, (2) coin, (3) what happened.
 * No side effects.
 */
function formatAlertMessage(payload) {
  if (!payload || typeof payload !== 'object') return 'Alert triggered.';
  const name = payload.name || 'Alert';
  const coin = shortSymbol(payload.coinSymbol || payload.symbol || '');

  if (payload.alertType === 'price') {
    const cond = payload.condition === 'below' ? 'below' : 'above';
    const target = payload.targetValue != null ? Number(payload.targetValue) : null;
    const current = payload.currentPrice != null ? Number(payload.currentPrice) : null;
    const targetStr = target != null && Number.isFinite(target) ? target.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—';
    const currentStr = current != null && Number.isFinite(current) ? current.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—';
    const what = `Price alert hit: ${coin || 'symbol'} ${cond} $${targetStr} (current: $${currentStr})`;
    return `${name}\n${coin || '—'}\n${what}`;
  }

  if (payload.alertType === 'complex') {
    const symbol = payload.symbol || '';
    const coinDisplay = shortSymbol(symbol) || coin || '—';
    const pct = payload.pctChange != null && Number.isFinite(payload.pctChange)
      ? `${payload.pctChange.toFixed(2)}%`
      : '—';
    const windowSec = payload.windowSeconds;
    const timeframeLabel = formatTimeframeLabel(windowSec) || 'selected timeframe';
    const what = `Complex alert hit: ${coinDisplay} moved ${pct} in ${timeframeLabel}`;
    const fromTo =
      payload.baselinePrice != null &&
      payload.currentPrice != null &&
      Number.isFinite(payload.baselinePrice) &&
      Number.isFinite(payload.currentPrice)
        ? ` (from $${Number(payload.baselinePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} to $${Number(payload.currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })})`
        : '';
    return `${name}\n${coinDisplay}\n${what}${fromTo}`;
  }

  return `${name}\n${coin || '—'}\nAlert triggered.`;
}

/**
 * If user has telegramChatId, send formatted alert to Telegram. Catches and logs errors; does not throw.
 */
async function sendAlertToTelegram(userId, payload) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });
    if (!user || !user.telegramChatId) {
      console.log(`[alertEngine] User ${userId} has no telegramChatId, skipping Telegram send`);
      return;
    }
    const text = formatAlertMessage(payload);
    await telegramService.sendMessage(user.telegramChatId, text);
    console.log(`[alertEngine] Sent alert to Telegram for user ${userId}`);
  } catch (err) {
    console.error('[alertEngine] sendAlertToTelegram failed:', err.message);
  }
}

function parseSymbols(symbols) {
  if (Array.isArray(symbols)) return symbols;
  if (typeof symbols !== 'string' || !symbols) return [];
  try {
    const p = JSON.parse(symbols);
    if (Array.isArray(p)) return p;
    if (typeof p === 'string' && p.trim()) return [p.trim()];
    return p ? [p] : [];
  } catch {
    return [symbols.trim()].filter(Boolean);
  }
}

function parseConditions(conditions) {
  if (!conditions) return [];
  if (Array.isArray(conditions)) return conditions;
  if (typeof conditions === 'string') {
    try {
      return JSON.parse(conditions);
    } catch {
      return [];
    }
  }
  return [];
}

function parseNotificationOptions(notifOptions) {
  if (!notifOptions) return {};
  if (typeof notifOptions === 'object' && !Array.isArray(notifOptions)) return notifOptions;
  if (typeof notifOptions === 'string') {
    try {
      return JSON.parse(notifOptions);
    } catch {
      return {};
    }
  }
  return {};
}

const TIMEFRAME_TO_INTERVAL = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

const TIMEFRAME_TO_SECONDS = {
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
};

function parseTimeframeSeconds(timeframe) {
  if (typeof timeframe !== 'string' || !timeframe) return 60;
  return TIMEFRAME_TO_SECONDS[timeframe] ?? 60;
}

/**
 * Check and trigger alerts. Uses Binance for price and complex alerts.
 * Price: alertType === 'price', first symbol vs targetValue.
 * Complex: alertType === 'complex', % move over timeframe.
 */
async function checkAlerts() {
  if (!alertEngineRunning || alertEngineShuttingDown || (LEASE_ENABLED && !leaseOwner)) {
    return;
  }

  if (alertCheckInProgress) {
    engineCounters.evaluateSkippedReentry += 1;
    logEngine('warn', 'evaluate.skip.reentry');
    return;
  }

  engineCounters.evaluateRuns += 1;
  alertCheckInProgress = true;
  try {
    // Fetch active alerts: price alerts must not be triggered (they self-delete), complex alerts can be triggered (keep monitoring)
    const activeAlerts = await prisma.alert.findMany({
      where: {
        isActive: true,
        OR: [
          { triggered: false }, // Price alerts and new complex alerts
          { alertType: 'complex', triggered: true }, // Complex alerts that already triggered (keep monitoring)
        ],
      },
    });

    if (activeAlerts.length === 0) return;

    // ---- Price alerts ----
    const priceAlerts = activeAlerts.filter((alert) => {
      if (alert.alertType !== 'price') return false;
      return parseSymbols(alert.symbols).length > 0;
    });

    if (priceAlerts.length > 0 && !fastPriceTimer) {
      await processPriceAlerts(priceAlerts, {
        onDeleted: async (alert) => {
          if (alert.condition === 'pct_change') {
            clearInitialPrice(alert.id);
          }
        },
        onTriggered: async (alert, payload) => {
          engineCounters.triggersPrice += 1;
          logEngine('info', 'trigger.price', { alertId: alert.id, userId: alert.userId, symbol: payload?.symbol || payload?.coinSymbol || null });
          socketService.emitAlertTriggered(alert.userId, payload);
          await sendAlertToTelegram(alert.userId, payload);
        },
        logger: console,
      });
    }

    // Complex alerts are now evaluated tick-by-tick in handlePriceTick().
    // No cron-based complex evaluation here — this loop only handles price alerts.
  } catch (error) {
    engineCounters.transientErrors += 1;
    logEngine('error', 'evaluate.error', { message: error?.message || String(error) });
  } finally {
    alertCheckInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Periodic klines sweep — catches crossings that the 300ms live engine missed
// (e.g. during a Render cold-start sleep, cache miss, or network outage).
// Runs every 2 minutes, completely independent of checkPriceAlertsFast.
// ---------------------------------------------------------------------------
let klinesSweepInProgress = false;
let klinesSweepTimer = null;
const KLINES_SWEEP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

async function runKlinesSweep() {
  if (!alertEngineRunning || alertEngineShuttingDown || (LEASE_ENABLED && !leaseOwner)) return;
  if (klinesSweepInProgress) return;
  klinesSweepInProgress = true;

  try {
    // Deferred require to break circular dependency (alertController → services → alertEngine)
    const { checkAlertHistorically } = require('../controllers/alertController');

    const priceAlerts = await prisma.alert.findMany({
      where: { isActive: true, triggered: false, alertType: 'price' },
    });

    if (!priceAlerts.length) return;

    logEngine('info', 'klines.sweep.start', { count: priceAlerts.length });

    const results = await Promise.allSettled(
      priceAlerts.map((alert) => checkAlertHistorically(alert)),
    );

    let triggeredCount = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled' || !result.value) continue;

      const payload = result.value;
      const alert = priceAlerts[i];
      triggeredCount++;

      engineCounters.triggersPrice += 1;
      logEngine('info', 'trigger.klines', {
        alertId: alert.id,
        userId: alert.userId,
        symbol: payload?.symbol || payload?.coinSymbol || null,
      });
      socketService.emitAlertTriggered(alert.userId, payload);
      await sendAlertToTelegram(alert.userId, payload);
    }

    logEngine('info', 'klines.sweep.done', { checked: priceAlerts.length, triggered: triggeredCount });
  } catch (error) {
    engineCounters.transientErrors += 1;
    logEngine('error', 'klines.sweep.error', { message: error?.message || String(error) });
  } finally {
    klinesSweepInProgress = false;
  }
}

async function checkPriceAlertsFast() {
  if (!alertEngineRunning || alertEngineShuttingDown || (LEASE_ENABLED && !leaseOwner)) {
    return;
  }

  if (fastPriceCheckInProgress) {
    engineCounters.priceSkippedReentry += 1;
    return;
  }

  engineCounters.priceRuns += 1;
  fastPriceCheckInProgress = true;
  try {
    const priceAlerts = await prisma.alert.findMany({
      where: {
        isActive: true,
        triggered: false,
        alertType: 'price',
      },
    });

    if (!Array.isArray(priceAlerts) || priceAlerts.length === 0) {
      return;
    }

    await processPriceAlerts(
      priceAlerts.filter((alert) => parseSymbols(alert.symbols).length > 0),
      {
        onDeleted: async (alert) => {
          if (alert.condition === 'pct_change') {
            clearInitialPrice(alert.id);
          }
        },
        onTriggered: async (alert, payload) => {
          engineCounters.triggersPrice += 1;
          logEngine('info', 'trigger.price', { alertId: alert.id, userId: alert.userId, symbol: payload?.symbol || payload?.coinSymbol || null });
          socketService.emitAlertTriggered(alert.userId, payload);
          await sendAlertToTelegram(alert.userId, payload);
        },
        logger: console,
      }
    );
  } catch (error) {
    engineCounters.transientErrors += 1;
    logEngine('error', 'evaluate.fast.error', { message: error?.message || String(error) });
  } finally {
    fastPriceCheckInProgress = false;
  }
}

async function startAlertEngine() {
  if (alertEngineRunning) {
    logEngine('warn', 'engine.start.duplicate');
    return;
  }

  alertEngineShuttingDown = false;
  alertEngineRunning = true;
  logEngine('info', 'engine.starting', {
    mode: LEASE_ENABLED ? 'lease-single-worker' : 'local-multi-worker',
    leaseName: LEASE_NAME,
    leaseTtlMs: LEASE_TTL_MS,
    heartbeatMs: LEASE_HEARTBEAT_MS,
    retryMs: LEASE_RETRY_MS,
  });

  // Complex alert loop runs independently of the lease system — start immediately.
  // This ensures complex alerts are ALWAYS evaluated regardless of lease flapping.
  startComplexLoop();

  try {
    await ensureLeaseTable();
    await runLeaseCoordinatorTick('startup');
    const cadenceMs = LEASE_ENABLED ? Math.min(LEASE_HEARTBEAT_MS, LEASE_RETRY_MS) : LEASE_HEARTBEAT_MS;
    leaseCoordinatorTimer = setInterval(() => {
      runLeaseCoordinatorTick('interval');
    }, cadenceMs);

    logEngine('info', 'engine.started', {
      mode: LEASE_ENABLED ? 'lease-single-worker' : 'local-multi-worker',
      workerActive: engineWorkerActive,
      counters: engineCounters,
    });
  } catch (error) {
    engineCounters.transientErrors += 1;
    logEngine('error', 'engine.start.failed', {
      message: error?.message || String(error),
      fallback: 'start-without-lease',
    });

    // Do not fail process startup because of lease bootstrap issues.
    // Fallback keeps alerts operational on single-instance deployments.
    leaseOwner = true;
    if (!engineWorkerActive) {
      startWorkerLoops();
    }

    logEngine('warn', 'engine.start.fallback', {
      mode: 'no-lease-fallback',
      workerActive: engineWorkerActive,
    });
  }
}

async function stopAlertEngine() {
  if (!alertEngineRunning && !alertEngineShuttingDown) {
    return;
  }

  alertEngineShuttingDown = true;
  if (leaseCoordinatorTimer) {
    clearInterval(leaseCoordinatorTimer);
    leaseCoordinatorTimer = null;
  }

  stopComplexLoop();
  stopWorkerLoops('shutdown');
  await waitForInFlightChecks(5000);

  try {
    await releaseLease('shutdown');
  } catch (error) {
    engineCounters.transientErrors += 1;
    logEngine('error', 'lease.release.error', { message: error?.message || String(error) });
  }

  alertEngineRunning = false;
  alertEngineShuttingDown = false;
  leaseOwner = false;
  logEngine('info', 'engine.stopped', { counters: engineCounters });
}

function getEngineStatus() {
  return {
    running: alertEngineRunning,
    workerActive: engineWorkerActive,
    leaseEnabled: LEASE_ENABLED,
    leaseOwner,
    instanceId: ENGINE_INSTANCE_ID,
    fastIntervalMs: FAST_PRICE_ALERT_INTERVAL_MS,
    counters: { ...engineCounters },
    ts: nowIso(),
  };
}

module.exports = {
  startAlertEngine,
  stopAlertEngine,
  checkAlerts,
  setInitialPrice,
  clearInitialPrice,
  getEngineStatus,
  refreshComplexAlertsCache,
};
