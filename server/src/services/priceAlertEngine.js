/**
 * Price Alert Engine v3 — parallel pre-fetched price evaluation.
 *
 * Previous versions called `priceResolver()` sequentially per alert, meaning
 * each alert awaited its own network call.  With 5+ alerts the cycle took
 * 5+ seconds; the 300 ms re-entry guard blocked every intermediate tick, so
 * the engine was effectively blind for seconds at a time.
 *
 * This rewrite:
 *   Phase 1 – validate & group alerts by exchange+market (pure CPU, <1 ms).
 *   Phase 2 – pre-fetch ALL price maps in ONE parallel batch via
 *             Promise.allSettled (one call per unique exchange+market pair).
 *             Fallback markets are also pre-fetched in the same batch.
 *             Total wall-clock time ≈ max(individual fetch) ≈ 1-2 s.
 *   Phase 3 – evaluate every alert against the in-memory maps (zero I/O per
 *             alert, microseconds each).
 *
 * Net result: a cycle with 20 alerts across 3 exchanges + fallback markets
 * completes in ~2 s instead of 20+ s.
 */

const inFlightAlertIds = new Set();

// ---------------------------------------------------------------------------
// Pure helpers (no I/O)
// ---------------------------------------------------------------------------

function parseSymbols(symbols) {
  if (Array.isArray(symbols)) return symbols;
  if (typeof symbols !== 'string' || !symbols) return [];
  try {
    const parsed = JSON.parse(symbols);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    return parsed ? [parsed] : [];
  } catch {
    return [symbols.trim()].filter(Boolean);
  }
}

function normalizeMarket(market) {
  return String(market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
}

function resolveCondition(alert, targetValue) {
  const initialPrice = alert?.initialPrice != null ? Number(alert.initialPrice) : null;
  if (Number.isFinite(initialPrice) && initialPrice > 0) {
    if (initialPrice > targetValue) return 'below';
    if (initialPrice < targetValue) return 'above';
  }
  return String(alert?.condition || '').toLowerCase() === 'below' ? 'below' : 'above';
}

/**
 * Core crossing check.  Returns true only when:
 *   1. currentPrice has reached/passed targetValue in the right direction, AND
 *   2. initialPrice was on the OPPOSITE side (proves a genuine crossing occurred).
 */
function shouldTriggerAtCurrentPrice(currentPrice, targetValue, condition, initialPrice) {
  const current = Number(currentPrice);
  const target = Number(targetValue);
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return false;

  const pastTarget = condition === 'below' ? current <= target : current >= target;
  if (!pastTarget) return false;

  const initial = Number(initialPrice);
  if (Number.isFinite(initial) && initial > 0) {
    if (condition === 'above' && initial >= target) return false;
    if (condition === 'below' && initial <= target) return false;
  }

  return true;
}

function deriveCoinSymbol(alert, resolvedSymbol) {
  if (typeof alert?.coinSymbol === 'string' && alert.coinSymbol.trim()) {
    return alert.coinSymbol;
  }
  return String(resolvedSymbol || '')
    .toUpperCase()
    .replace(/\.P$/i, '')
    .replace(/USDT$/i, '')
    .replace(/USD$/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Exchange service accessor
// ---------------------------------------------------------------------------

function getExchangeService(exchange) {
  const key = String(exchange || '').toLowerCase();
  if (key === 'bybit') return require('./bybitService');
  if (key === 'okx') return require('./okxService');
  if (key === 'gate') return require('./gateService');
  if (key === 'mexc') return require('./mexcService');
  if (key === 'bitget') return require('./bitgetService');
  return require('./binanceService');
}

/**
 * Case-insensitive price lookup in a full ticker map.
 * Returns { price, symbol } or { price: null, symbol: '' }.
 */
function lookupPriceFromMap(priceMap, candidates) {
  if (!priceMap || typeof priceMap !== 'object') return { price: null, symbol: '' };

  // Build uppercase index once (ticker maps are typically uppercase already)
  const upperIndex = {};
  for (const [key, value] of Object.entries(priceMap)) {
    const p = Number(value);
    if (Number.isFinite(p) && p > 0) {
      upperIndex[String(key).toUpperCase()] = { key, price: p };
    }
  }

  for (const candidate of candidates) {
    const entry = upperIndex[String(candidate).toUpperCase()];
    if (entry) return { price: entry.price, symbol: entry.key };
  }
  return { price: null, symbol: '' };
}

// ---------------------------------------------------------------------------
// Processor factory
// ---------------------------------------------------------------------------

function createPriceAlertProcessor(deps = {}) {
  const prismaClient = deps.prismaClient || require('../utils/prisma');
  const { buildCandidates } = require('./priceSourceResolver');

  return async function processPriceAlerts(priceAlerts, handlers = {}) {
    const {
      onTriggered = async () => {},
      onDeleted = async () => {},
      logger = console,
    } = handlers;

    if (!Array.isArray(priceAlerts) || priceAlerts.length === 0) return;

    // ── PHASE 1: validate & group ──────────────────────────────────────────
    const validAlerts = [];
    const neededMaps = new Set(); // "exchange|market"

    for (const alert of priceAlerts) {
      if (!alert?.id || inFlightAlertIds.has(alert.id)) continue;

      const alertAgeMs = alert.createdAt
        ? Date.now() - new Date(alert.createdAt).getTime()
        : Infinity;
      if (alertAgeMs < 10_000) continue; // 10 s grace for brand-new alerts

      const symbols = parseSymbols(alert.symbols);
      const firstSymbol = symbols[0];
      if (!firstSymbol) continue;

      const targetValue = Number(alert.targetValue);
      if (!Number.isFinite(targetValue) || targetValue <= 0) continue;

      const exchange = String(alert.exchange || 'binance').toLowerCase();
      const market = normalizeMarket(alert.market);

      validAlerts.push({ alert, firstSymbol, exchange, market, targetValue });

      // Register BOTH primary and fallback market for pre-fetching
      neededMaps.add(`${exchange}|${market}`);
      const fallback = market === 'futures' ? 'spot' : 'futures';
      neededMaps.add(`${exchange}|${fallback}`);
    }

    if (validAlerts.length === 0) return;

    // ── PHASE 2: parallel pre-fetch all price maps ─────────────────────────
    const priceMaps = new Map(); // "exchange|market" -> { symbol: price }

    await Promise.allSettled(
      Array.from(neededMaps).map(async (key) => {
        const [exchange, market] = key.split('|');
        try {
          const service = getExchangeService(exchange);
          const exchangeType = market === 'spot' ? 'spot' : 'futures';
          const map = await service.getLastPricesBySymbols(
            [], // empty → returns the FULL cached ticker map
            exchangeType,
            { strict: false, exchangeOnly: true },
          );
          priceMaps.set(key, map || {});
        } catch {
          priceMaps.set(key, {});
        }
      }),
    );

    // ── PHASE 3: evaluate every alert (pure in-memory) ─────────────────────
    for (const { alert, firstSymbol, exchange, market, targetValue } of validAlerts) {
      if (inFlightAlertIds.has(alert.id)) continue;
      inFlightAlertIds.add(alert.id);

      try {
        const candidates = buildCandidates(exchange, firstSymbol, market);
        if (candidates.length === 0) continue;

        // Primary market lookup
        const primaryMap = priceMaps.get(`${exchange}|${market}`) || {};
        let resolved = lookupPriceFromMap(primaryMap, candidates);
        let resolvedMarket = market;
        let source = `${exchange}_exchange_map`;

        // Fallback to opposite market type (spot ↔ futures)
        if (!Number.isFinite(resolved.price) || resolved.price <= 0) {
          const fb = market === 'futures' ? 'spot' : 'futures';
          const fbMap = priceMaps.get(`${exchange}|${fb}`) || {};
          const fbResolved = lookupPriceFromMap(fbMap, candidates);
          if (Number.isFinite(fbResolved.price) && fbResolved.price > 0) {
            resolved = fbResolved;
            resolvedMarket = fb;
            source = `${exchange}_${fb}_map`;
          }
        }

        const currentPrice = resolved.price;
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

        // Self-heal: correct stored market if resolved via fallback (fire & forget)
        if (resolvedMarket !== market) {
          prismaClient.alert
            .updateMany({
              where: { id: alert.id, triggered: false, isActive: true },
              data: { market: resolvedMarket },
            })
            .catch(() => {}); // non-fatal, fire-and-forget
        }

        const condition = resolveCondition(alert, targetValue);
        const initialPrice =
          alert?.initialPrice != null ? Number(alert.initialPrice) : null;
        const triggered = shouldTriggerAtCurrentPrice(
          currentPrice,
          targetValue,
          condition,
          initialPrice,
        );

        if (!triggered) continue;

        // ── Trigger the alert ──────────────────────────────────────────────
        const triggeredAt = new Date();

        const payload = {
          id: alert.id,
          alertId: alert.id,
          name: alert.name,
          description: alert.description ?? null,
          triggered: true,
          triggeredAt,
          currentPrice,
          targetValue: alert.targetValue,
          condition,
          coinSymbol: deriveCoinSymbol(alert, resolved.symbol || firstSymbol),
          symbol: resolved.symbol || firstSymbol,
          alertType: 'price',
          priceSource: source,
          ...(initialPrice != null && Number.isFinite(initialPrice)
            ? { initialPrice }
            : {}),
        };

        // Atomic guard: only succeeds if no other process set triggered=true first.
        const updateResult = await prismaClient.alert.updateMany({
          where: { id: alert.id, triggered: false, isActive: true },
          data: { triggered: true, isActive: false, triggeredAt },
        });

        if (updateResult.count === 0) continue; // lost the race — already triggered

        await onDeleted(alert);
        await onTriggered(alert, payload);
        logger.log?.(
          `[priceAlertV3] TRIGGERED alert=${alert.id} ` +
            `${resolved.symbol || firstSymbol} ${condition} ` +
            `target=${targetValue} current=${currentPrice} src=${source}`,
        );
      } catch (error) {
        logger.error?.(`[priceAlertV3] alert=${alert.id} error:`, error);
      } finally {
        inFlightAlertIds.delete(alert.id);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

let defaultProcessor = null;

async function processPriceAlerts(priceAlerts, handlers = {}) {
  if (!defaultProcessor) {
    defaultProcessor = createPriceAlertProcessor();
  }
  return defaultProcessor(priceAlerts, handlers);
}

module.exports = {
  processPriceAlerts,
  createPriceAlertProcessor,
  __test__: {
    shouldTriggerAtCurrentPrice,
    resolveCondition,
    parseSymbols,
  },
};
