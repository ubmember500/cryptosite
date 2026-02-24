const prisma = require('../utils/prisma');
const binanceService = require('./binanceService');
const bybitService = require('./bybitService');
const okxService = require('./okxService');
const gateService = require('./gateService');
const mexcService = require('./mexcService');
const bitgetService = require('./bitgetService');

/* ================================================================
 *  Price Alert Engine — simplified, robust, stateless trigger logic
 *
 *  Design:
 *    1. For each active price alert, fetch the current price.
 *    2. Compare currentPrice directly against targetValue:
 *       - condition 'below': trigger when currentPrice <= targetValue
 *       - condition 'above': trigger when currentPrice >= targetValue
 *    3. No "zone-crossing" between consecutive observations.
 *       The controller guarantees that at creation time initialPrice
 *       is on the OPPOSITE side of the target, so a simple threshold
 *       comparison is correct.
 *    4. On trigger: delete alert from DB, notify user via socket + Telegram.
 * ================================================================ */

// Guard against concurrent trigger+delete for the same alert within one tick
const inFlightAlertIds = new Set();

// ---------- helpers ----------

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

function getExchangeService(exchange) {
  const key = String(exchange || 'binance').toLowerCase();
  if (key === 'bybit') return bybitService;
  if (key === 'okx') return okxService;
  if (key === 'gate') return gateService;
  if (key === 'mexc') return mexcService;
  if (key === 'bitget') return bitgetService;
  return binanceService;
}

/** Uppercase, keep alphanumeric + dot (for .P futures suffix) */
function normalizeRawSymbol(rawSymbol) {
  if (typeof rawSymbol !== 'string') return '';
  return rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

/**
 * Build candidate symbol strings to try against the exchange API.
 * We normalise through the exchange service ONLY for the base symbol
 * (without .P) so the dot is never stripped.  Then we add .P variants
 * for futures *after* normalisation.
 */
function buildCandidates(exchange, rawSymbol, market) {
  const service = getExchangeService(exchange);
  const raw = normalizeRawSymbol(rawSymbol);
  if (!raw) return [];

  // Strip trailing .P if present; we'll add it back for futures
  const base = raw.replace(/\.P$/i, '');

  // Normalise through exchange-specific function (strip "/" etc., uppercase)
  let normBase = base;
  if (typeof service.normalizeSymbol === 'function') {
    try {
      const n = service.normalizeSymbol(base);
      if (n) normBase = n;
    } catch { /* keep normBase */ }
  }
  normBase = normBase.toUpperCase();

  const set = new Set();
  set.add(normBase);                                         // ESPUSDT

  // Add quote-suffixed variants
  const hasQuote = /(USDT|USD)$/i.test(normBase);
  if (!hasQuote) {
    set.add(`${normBase}USDT`);                              // ESP → ESPUSDT
    set.add(`${normBase}USD`);                               // ESP → ESPUSD
  } else {
    // Also try without quote suffix (some exchanges use base only)
    const stripped = normBase.replace(/USDT$|USD$/i, '');
    if (stripped) set.add(stripped);
  }

  // For futures, add .P variants
  if (market === 'futures') {
    for (const s of Array.from(set)) {
      set.add(`${s}.P`);
    }
  }

  return Array.from(set).filter(Boolean);
}

/** Resolve a price from a map { SYMBOL: price } trying candidates in order. */
function resolvePriceFromMap(priceMap, candidates) {
  if (!priceMap || typeof priceMap !== 'object') return { price: null, symbol: '' };

  // Build an uppercase lookup for case-insensitive matching
  const upperMap = new Map();
  for (const [k, v] of Object.entries(priceMap)) {
    upperMap.set(String(k).toUpperCase(), { key: k, value: Number(v) });
  }

  for (const c of candidates) {
    const entry = upperMap.get(String(c).toUpperCase());
    if (entry && Number.isFinite(entry.value) && entry.value > 0) {
      return { price: entry.value, symbol: entry.key };
    }
  }
  return { price: null, symbol: '' };
}

/**
 * Fetch the **current live price** for a single symbol.
 *
 * Strategy (ordered by reliability):
 *   1. getLastPricesBySymbols with strict=false (uses 2-second cache → bulk ticker → per-symbol fallback)
 *   2. fetchCurrentPriceBySymbol (direct /ticker/price per candidate)
 */
async function fetchCurrentPrice(exchange, market, rawSymbol) {
  const service = getExchangeService(exchange);
  const exchangeType = market === 'spot' ? 'spot' : 'futures';
  const candidates = buildCandidates(exchange, rawSymbol, market);
  if (candidates.length === 0) return { price: null, symbol: '' };

  // Strategy 1 — bulk/cached path (DO NOT set exchangeOnly so per-symbol fallback is available)
  try {
    const priceMap = await service.getLastPricesBySymbols(candidates, exchangeType, {
      strict: false,
      exchangeOnly: false,
    });
    const resolved = resolvePriceFromMap(priceMap, candidates);
    if (Number.isFinite(resolved.price) && resolved.price > 0) return resolved;
  } catch { /* fall through */ }

  // Strategy 2 — direct single-symbol ticker
  if (typeof service.fetchCurrentPriceBySymbol === 'function') {
    for (const candidate of candidates) {
      try {
        const price = Number(await service.fetchCurrentPriceBySymbol(candidate, exchangeType));
        if (Number.isFinite(price) && price > 0) return { price, symbol: candidate };
      } catch { /* try next */ }
    }
  }

  return { price: null, symbol: candidates[0] || '' };
}

// ---------- trigger logic ----------

/**
 * Determine effective condition from DB alert.
 * The controller already stores the correct condition, but re-derive from
 * initialPrice vs targetValue as a safety net.
 */
function resolveCondition(alert, targetValue) {
  const ip = alert?.initialPrice != null ? Number(alert.initialPrice) : null;
  if (Number.isFinite(ip) && ip > 0) {
    if (ip > targetValue) return 'below';
    if (ip < targetValue) return 'above';
  }
  return String(alert?.condition || '').toLowerCase() === 'below' ? 'below' : 'above';
}

/**
 * SIMPLE threshold trigger — no zone-crossing, no state.
 * Returns true when the current price has reached (or passed) the target.
 */
function shouldTrigger(currentPrice, targetValue, condition) {
  const cur = Number(currentPrice);
  const tgt = Number(targetValue);
  if (!Number.isFinite(cur) || !Number.isFinite(tgt)) return false;

  if (condition === 'below') return cur <= tgt;
  return cur >= tgt; // 'above'
}

// ---------- helpers ----------

function getCoinSymbol(alert, resolvedSymbol) {
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

// ---------- main entry ----------

async function processPriceAlerts(priceAlerts, handlers = {}) {
  const {
    onTriggered = async () => {},
    onDeleted = async () => {},
    logger = console,
  } = handlers;

  for (const alert of priceAlerts || []) {
    // Prevent double-processing if a previous tick is still deleting this alert
    if (inFlightAlertIds.has(alert.id)) continue;
    inFlightAlertIds.add(alert.id);

    try {
      const symbols = parseSymbols(alert.symbols);
      const firstSymbol = symbols[0];
      if (!firstSymbol) {
        logger.warn?.(`[priceAlert] alert=${alert.id} — no symbol, skipping`);
        continue;
      }

      const exchange = String(alert.exchange || 'binance').toLowerCase();
      const market = String(alert.market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
      const targetValue = Number(alert.targetValue);
      if (!Number.isFinite(targetValue) || targetValue <= 0) {
        logger.warn?.(`[priceAlert] alert=${alert.id} — bad targetValue=${alert.targetValue}, skipping`);
        continue;
      }

      // ---- Fetch current price ----
      const current = await fetchCurrentPrice(exchange, market, firstSymbol);
      const currentPrice = Number(current.price);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        logger.warn?.(
          `[priceAlert] alert=${alert.id} sym=${firstSymbol} exchange=${exchange}/${market} — price unavailable, skipping`
        );
        continue;
      }

      // ---- Determine condition and check trigger ----
      const condition = resolveCondition(alert, targetValue);
      const triggered = shouldTrigger(currentPrice, targetValue, condition);

      logger.log?.(
        `[priceAlert] alert=${alert.id} sym=${firstSymbol} ` +
        `target=${targetValue} current=${currentPrice} cond=${condition} ` +
        `triggered=${triggered}`
      );

      if (!triggered) continue;

      // ---- TRIGGERED — delete + notify ----
      const payload = {
        id: alert.id,
        alertId: alert.id,
        name: alert.name,
        description: alert.description ?? null,
        triggered: true,
        triggeredAt: new Date(),
        currentPrice,
        targetValue: alert.targetValue,
        condition,
        coinSymbol: getCoinSymbol(alert, current.symbol || firstSymbol),
        symbol: current.symbol || firstSymbol,
        alertType: 'price',
        ...(alert.initialPrice != null && Number.isFinite(Number(alert.initialPrice))
          ? { initialPrice: Number(alert.initialPrice) }
          : {}),
      };

      try {
        await prisma.alert.delete({ where: { id: alert.id } });
      } catch (error) {
        if (error?.code === 'P2025') {
          logger.warn?.(`[priceAlert] alert=${alert.id} already deleted by another tick`);
          continue;
        }
        throw error;
      }

      await onDeleted(alert);
      await onTriggered(alert, payload);
      logger.log?.(
        `[priceAlert] ✅ TRIGGERED alert=${alert.id} sym=${firstSymbol} ` +
        `target=${targetValue} current=${currentPrice} cond=${condition}`
      );
    } catch (err) {
      logger.error?.(`[priceAlert] alert=${alert.id} unexpected error:`, err);
    } finally {
      inFlightAlertIds.delete(alert.id);
    }
  }
}

module.exports = {
  processPriceAlerts,
};
