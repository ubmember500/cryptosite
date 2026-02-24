const prisma = require('../utils/prisma');
const binanceService = require('./binanceService');
const bybitService = require('./bybitService');
const okxService = require('./okxService');
const gateService = require('./gateService');
const mexcService = require('./mexcService');
const bitgetService = require('./bitgetService');

const lastObservedPriceByAlertId = new Map();
const inFlightAlertIds = new Set();

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

function normalizeRawSymbol(rawSymbol) {
  if (typeof rawSymbol !== 'string') return '';
  return rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

function buildSymbolCandidates(rawSymbol, market) {
  const base = normalizeRawSymbol(rawSymbol);
  if (!base) return [];

  const candidates = new Set([base]);
  if (!/(USDT|USD)(\.P)?$/i.test(base)) {
    candidates.add(`${base}USDT`);
    candidates.add(`${base}USD`);
  }

  for (const candidate of Array.from(candidates)) {
    const noPerp = candidate.replace(/\.P$/i, '');
    candidates.add(noPerp);

    if (market === 'futures') {
      if (!candidate.endsWith('.P')) candidates.add(`${candidate}.P`);
      if (noPerp !== candidate) candidates.add(noPerp);
    }
  }

  return Array.from(candidates).filter(Boolean);
}

function normalizeForExchange(exchange, symbol) {
  const service = getExchangeService(exchange);
  if (typeof service.normalizeSymbol === 'function') {
    try {
      const normalized = service.normalizeSymbol(symbol);
      if (typeof normalized === 'string' && normalized) return normalized;
    } catch {
      // fall through to generic normalization
    }
  }
  return normalizeRawSymbol(symbol);
}

function buildExchangeCandidates(exchange, rawSymbol, market) {
  const candidateSet = new Set();
  const rawCandidates = buildSymbolCandidates(rawSymbol, market);

  for (const candidate of rawCandidates) {
    const normalized = normalizeForExchange(exchange, candidate);
    if (!normalized) continue;

    candidateSet.add(normalized);
    candidateSet.add(normalized.toUpperCase());

    const noPerp = normalized.replace(/\.P$/i, '');
    candidateSet.add(noPerp);

    if (!/(USDT|USD)$/i.test(noPerp)) {
      candidateSet.add(`${noPerp}USDT`);
      candidateSet.add(`${noPerp}USD`);
    }

    if (market === 'futures') {
      candidateSet.add(`${noPerp}.P`);
      candidateSet.add(`${noPerp}USDT.P`);
      candidateSet.add(`${noPerp}USD.P`);
    }
  }

  return Array.from(candidateSet).filter(Boolean);
}

function resolvePriceFromMap(priceMap, candidates) {
  if (!priceMap || typeof priceMap !== 'object') {
    return { price: null, symbol: '' };
  }

  const byUpper = new Map(
    Object.entries(priceMap).map(([key, value]) => [String(key).toUpperCase(), value])
  );

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(priceMap, candidate)) {
      const direct = Number(priceMap[candidate]);
      if (Number.isFinite(direct) && direct > 0) {
        return { price: direct, symbol: candidate };
      }
    }

    const upperValue = byUpper.get(String(candidate).toUpperCase());
    const parsed = Number(upperValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { price: parsed, symbol: candidate };
    }
  }

  return { price: null, symbol: '' };
}

async function fetchCurrentPrice(exchange, market, rawSymbol) {
  const service = getExchangeService(exchange);
  const exchangeType = market === 'spot' ? 'spot' : 'futures';
  const candidates = buildExchangeCandidates(exchange, rawSymbol, market);

  if (candidates.length === 0) {
    return { price: null, symbol: '' };
  }

  try {
    const priceMap = await service.getLastPricesBySymbols(candidates, exchangeType, {
      strict: false,
      exchangeOnly: true,
    });
    const resolved = resolvePriceFromMap(priceMap, candidates);
    if (Number.isFinite(resolved.price) && resolved.price > 0) {
      return resolved;
    }
  } catch {
    // ignore and fallback
  }

  if (typeof service.fetchCurrentPriceBySymbol === 'function') {
    for (const candidate of candidates) {
      try {
        const price = Number(await service.fetchCurrentPriceBySymbol(candidate, exchangeType));
        if (Number.isFinite(price) && price > 0) {
          return { price, symbol: candidate };
        }
      } catch {
        // continue
      }
    }
  }

  return { price: null, symbol: candidates[0] || '' };
}

function getPriceTolerance(targetValue) {
  const target = Number(targetValue);
  if (!Number.isFinite(target)) return 1e-8;
  return Math.max(Math.abs(target) * 1e-4, 1e-8);
}

function classifyRelativeToTarget(price, targetValue) {
  const numericPrice = Number(price);
  const target = Number(targetValue);
  if (!Number.isFinite(numericPrice) || !Number.isFinite(target)) return null;

  const tolerance = getPriceTolerance(target);
  const delta = numericPrice - target;

  if (Math.abs(delta) <= tolerance) return 0;
  return delta > 0 ? 1 : -1;
}

function resolveCondition(alert, targetValue) {
  const initialPrice = alert?.initialPrice != null ? Number(alert.initialPrice) : null;
  if (Number.isFinite(initialPrice) && initialPrice > 0) {
    if (initialPrice > targetValue) return 'below';
    if (initialPrice < targetValue) return 'above';
  }
  return String(alert?.condition || '').toLowerCase() === 'below' ? 'below' : 'above';
}

function shouldTrigger(previousPrice, currentPrice, targetValue, condition) {
  const previousZone = classifyRelativeToTarget(previousPrice, targetValue);
  const currentZone = classifyRelativeToTarget(currentPrice, targetValue);

  if (previousZone == null || currentZone == null) return false;
  if (previousZone === 0) return false;

  if (condition === 'below') {
    return previousZone > 0 && currentZone <= 0;
  }

  return previousZone < 0 && currentZone >= 0;
}

function getCoinSymbol(alert, resolvedSymbol) {
  if (typeof alert?.coinSymbol === 'string' && alert.coinSymbol.trim()) {
    return alert.coinSymbol;
  }
  const normalized = String(resolvedSymbol || '').toUpperCase();
  return normalized
    .replace(/\.P$/i, '')
    .replace(/USDT$/i, '')
    .replace(/USD$/i, '')
    .trim();
}

function pruneRuntime(activeAlertIds) {
  for (const alertId of Array.from(lastObservedPriceByAlertId.keys())) {
    if (!activeAlertIds.has(alertId)) {
      lastObservedPriceByAlertId.delete(alertId);
    }
  }
}

async function processPriceAlerts(priceAlerts, handlers = {}) {
  const {
    onTriggered = async () => {},
    onDeleted = async () => {},
    logger = console,
  } = handlers;

  const activeIds = new Set((priceAlerts || []).map((alert) => alert.id));
  pruneRuntime(activeIds);

  for (const alert of priceAlerts || []) {
    if (inFlightAlertIds.has(alert.id)) continue;
    inFlightAlertIds.add(alert.id);

    try {
      const symbols = parseSymbols(alert.symbols);
      const firstSymbol = symbols[0];
      if (!firstSymbol) {
        logger.warn?.(`[priceAlertEngine] Alert ${alert.id} has no symbol, skipping`);
        continue;
      }

      const exchange = String(alert.exchange || 'binance').toLowerCase();
      const market = String(alert.market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
      const targetValue = Number(alert.targetValue);
      if (!Number.isFinite(targetValue) || targetValue <= 0) {
        continue;
      }

      const current = await fetchCurrentPrice(exchange, market, firstSymbol);
      const currentPrice = Number(current.price);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        logger.warn?.(`[priceAlertEngine] Price unavailable for alert ${alert.id}, symbol ${firstSymbol}`);
        continue;
      }

      const previousObserved = Number(lastObservedPriceByAlertId.get(alert.id));
      const initialPrice = alert.initialPrice != null ? Number(alert.initialPrice) : null;
      const previousPrice = Number.isFinite(previousObserved)
        ? previousObserved
        : (Number.isFinite(initialPrice) && initialPrice > 0 ? initialPrice : null);

      if (!Number.isFinite(previousPrice)) {
        lastObservedPriceByAlertId.set(alert.id, currentPrice);
        continue;
      }

      const resolvedCondition = resolveCondition(alert, targetValue);
      const triggered = shouldTrigger(previousPrice, currentPrice, targetValue, resolvedCondition);
      if (!triggered) {
        lastObservedPriceByAlertId.set(alert.id, currentPrice);
        continue;
      }

      const payload = {
        id: alert.id,
        alertId: alert.id,
        name: alert.name,
        description: alert.description ?? null,
        triggered: true,
        triggeredAt: new Date(),
        currentPrice,
        targetValue: alert.targetValue,
        condition: resolvedCondition,
        coinSymbol: getCoinSymbol(alert, current.symbol || firstSymbol),
        symbol: current.symbol || normalizeForExchange(exchange, firstSymbol),
        alertType: 'price',
        ...(alert.initialPrice != null && Number.isFinite(alert.initialPrice)
          ? { initialPrice: alert.initialPrice }
          : {}),
      };

      try {
        await prisma.alert.delete({ where: { id: alert.id } });
      } catch (error) {
        if (error?.code === 'P2025') {
          logger.warn?.(`[priceAlertEngine] Alert ${alert.id} already deleted`);
          continue;
        }
        throw error;
      }

      lastObservedPriceByAlertId.delete(alert.id);
      await onDeleted(alert);
      await onTriggered(alert, payload);
      logger.log?.(`[priceAlertEngine] Triggered and deleted alert ${alert.id}`);
    } finally {
      inFlightAlertIds.delete(alert.id);
    }
  }
}

module.exports = {
  processPriceAlerts,
};
