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
const {
  getPriceTolerance,
  hasTouchedTargetWithTolerance,
  hasCrossedTargetWithTolerance,
} = require('./priceAlertTrigger');

let alertEngineRunning = false;

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
const priceAlertLastObserved = new Map(); // alertId -> last observed currentPrice

function prunePriceAlertRuntimeState(activePriceAlertIds) {
  for (const alertId of Array.from(priceAlertLastObserved.keys())) {
    if (!activePriceAlertIds.has(alertId)) {
      priceAlertLastObserved.delete(alertId);
    }
  }
}

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
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let oldest = null;
  let current = null;
  let points = 0;

  for (let i = 0; i < arr.length; i += 1) {
    const p = arr[i];
    if (p.ts < cutoff) continue;
    if (!Number.isFinite(p.price) || p.price <= 0) continue;
    if (oldest == null) oldest = p.price;
    if (p.price < min) min = p.price;
    if (p.price > max) max = p.price;
    current = p.price;
    points += 1;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || points < 2 || current == null || oldest == null) {
    return null;
  }

  return { min, max, oldest, current, points };
}

function canEmitComplexTrigger(alertId, symbol, nowMs, cooldownMs = 60000) {
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
    return Array.isArray(p) ? p : [p];
  } catch {
    return [];
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

function normalizeSymbolForExchange(exchange, symbol) {
  const raw = String(symbol || '').trim();
  if (!raw) return '';

  const key = String(exchange || '').toLowerCase();
  const normalize =
    key === 'bybit'
      ? bybitService.normalizeSymbol
      : key === 'okx'
        ? okxService.normalizeSymbol
        : key === 'gate'
          ? gateService.normalizeSymbol
          : key === 'mexc'
            ? mexcService.normalizeSymbol
            : key === 'bitget'
              ? bitgetService.normalizeSymbol
              : binanceService.normalizeSymbol;

  try {
    const normalized = normalize(raw);
    return typeof normalized === 'string' ? normalized : '';
  } catch {
    return raw.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  }
}

async function fetchCurrentPriceByExchangeSymbol(exchange, symbol, exchangeType) {
  const key = String(exchange || '').toLowerCase();
  const normalizedSymbol = normalizeSymbolForExchange(key, symbol);
  if (!normalizedSymbol) return null;

  const getPrices =
    key === 'bybit'
      ? () => bybitService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true, exchangeOnly: true })
      : key === 'okx'
        ? () => okxService.getLastPricesBySymbols([normalizedSymbol], exchangeType)
        : key === 'gate'
          ? () => gateService.getLastPricesBySymbols([normalizedSymbol], exchangeType)
          : key === 'mexc'
            ? () => mexcService.getLastPricesBySymbols([normalizedSymbol], exchangeType)
            : key === 'bitget'
              ? () => bitgetService.getLastPricesBySymbols([normalizedSymbol], exchangeType)
              : () => binanceService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true, exchangeOnly: true });

  try {
    const priceMap = await getPrices();
    const raw = resolvePriceForPriceAlert(priceMap || {}, normalizedSymbol, exchangeType);
    const price = Number(raw);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchFreshPricesForKey(exchange, exchangeType, symbols) {
  const key = String(exchange || '').toLowerCase();
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return {};
  }

  if (symbols.length > 30) {
    console.warn(`[alertEngine] Skipping fresh per-symbol prices for ${key}/${exchangeType}: too many symbols (${symbols.length})`);
    return {};
  }

  const freshMap = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const price = await fetchCurrentPriceByExchangeSymbol(key, symbol, exchangeType);
        if (!Number.isFinite(price) || price <= 0) return;
        freshMap[symbol] = price;
        freshMap[String(symbol).toUpperCase()] = price;
      } catch (error) {
        console.warn(`[alertEngine] Fresh price fetch failed for ${key} ${symbol}:`, error.message);
      }
    })
  );

  return freshMap;
}

function resolvePriceForPriceAlert(priceMap, symbol, market) {
  if (!priceMap || typeof priceMap !== 'object') return null;
  const raw = String(symbol || '').trim();
  if (!raw) return null;

  const candidates = new Set();
  candidates.add(raw);
  candidates.add(raw.toUpperCase());

  const compact = raw.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  if (compact) candidates.add(compact);

  if (market === 'futures') {
    for (const c of Array.from(candidates)) {
      if (c.endsWith('USDT') && !c.endsWith('.P')) candidates.add(`${c}.P`);
      if (c.endsWith('.P')) candidates.add(c.slice(0, -2));
    }
  }

  const entries = Object.entries(priceMap);
  const byUpper = new Map(entries.map(([k, v]) => [String(k).toUpperCase(), v]));

  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(priceMap, c)) return priceMap[c];
    const upperHit = byUpper.get(String(c).toUpperCase());
    if (upperHit != null) return upperHit;
  }

  return null;
}

/**
 * Check and trigger alerts. Uses Binance for price and complex alerts.
 * Price: alertType === 'price', first symbol vs targetValue.
 * Complex: alertType === 'complex', % move over timeframe.
 */
async function checkAlerts() {
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
    const priceAlerts = activeAlerts.filter((a) => {
      if (a.alertType !== 'price') return false;
      const syms = parseSymbols(a.symbols);
      return syms.length > 0;
    });

    const activePriceAlertIds = new Set(priceAlerts.map((a) => a.id));
    prunePriceAlertRuntimeState(activePriceAlertIds);

    if (priceAlerts.length > 0) {
      // Group by (exchange, market) so we fetch from the correct exchange
      const byExchangeMarket = new Map(); // key: 'exchange|market'
      for (const a of priceAlerts) {
        const ex = (a.exchange || 'binance').toLowerCase();
        const market = (a.market || 'futures').toLowerCase();
        const key = `${ex}|${market}`;
        if (!byExchangeMarket.has(key)) byExchangeMarket.set(key, []);
        byExchangeMarket.get(key).push(a);
      }

      const priceMapByKey = {};
      for (const [key, alerts] of byExchangeMarket) {
        const [exchange, market] = key.split('|');
        const symbols = [
          ...new Set(
            alerts
              .flatMap((a) => parseSymbols(a.symbols))
              .map((s) => normalizeSymbolForExchange(exchange, s))
              .filter(Boolean)
          ),
        ];
        const exchangeType = market === 'spot' ? 'spot' : 'futures';
        const getPrices =
          exchange === 'bybit'
            ? () => bybitService.getLastPricesBySymbols(symbols, exchangeType, { strict: true, exchangeOnly: true })
            : exchange === 'okx'
              ? () => okxService.getLastPricesBySymbols(symbols, exchangeType)
              : exchange === 'gate'
                ? () => gateService.getLastPricesBySymbols(symbols, exchangeType)
                : exchange === 'mexc'
                  ? () => mexcService.getLastPricesBySymbols(symbols, exchangeType)
                  : exchange === 'bitget'
                    ? () => bitgetService.getLastPricesBySymbols(symbols, exchangeType)
                    : () => binanceService.getLastPricesBySymbols(symbols, exchangeType, { strict: true, exchangeOnly: true });
        try {
          const [bulkPriceMap, freshPriceMap] = await Promise.all([
            getPrices(),
            fetchFreshPricesForKey(exchange, exchangeType, symbols),
          ]);
          priceMapByKey[key] = {
            ...(bulkPriceMap || {}),
            ...(freshPriceMap || {}),
          };
        } catch (err) {
          console.warn(`[alertEngine] Failed to fetch prices for ${key}:`, err.message);
          priceMapByKey[key] = {};
        }
      }

      const skippedMissing = new Set();

      for (const alert of priceAlerts) {
        const syms = parseSymbols(alert.symbols);
        const ex = (alert.exchange || 'binance').toLowerCase();
        const market = (alert.market || 'futures').toLowerCase();
        const firstSymbol = normalizeSymbolForExchange(ex, syms[0]);
        if (!firstSymbol) {
          console.warn(`[alertEngine] Alert ${alert.id} has invalid symbol, skipping`);
          continue;
        }
        const key = `${ex}|${market}`;
        const priceMap = priceMapByKey[key] || {};
        const currentPriceRaw = resolvePriceForPriceAlert(priceMap, firstSymbol, market);
        const currentPrice = Number(currentPriceRaw);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
          if (!skippedMissing.has(alert.id)) {
            console.warn(`Price not available for ${firstSymbol}, skipping alert ${alert.id}`);
            skippedMissing.add(alert.id);
          }
          continue;
        }

        const targetValue = Number(alert.targetValue);
        if (!Number.isFinite(targetValue)) continue;

        if (!Number.isFinite(currentPrice) || !Number.isFinite(targetValue)) {
          continue;
        }

        const initialPrice = alert.initialPrice != null ? Number(alert.initialPrice) : null;
        const hasValidInitialPrice = Number.isFinite(initialPrice) && initialPrice > 0;
        const previousObserved = priceAlertLastObserved.get(alert.id);
        const previousPrice = Number.isFinite(previousObserved)
          ? Number(previousObserved)
          : (hasValidInitialPrice ? initialPrice : null);

        const touchedTarget = hasTouchedTargetWithTolerance(currentPrice, targetValue);
        const crossedTarget = hasCrossedTargetWithTolerance(previousPrice, currentPrice, targetValue);
        const fallbackCondition = String(alert.condition || '').toLowerCase();
        const legacyDirectionHit =
          !Number.isFinite(previousPrice) &&
          !hasValidInitialPrice &&
          (fallbackCondition === 'below'
            ? currentPrice <= targetValue + getPriceTolerance(targetValue)
            : fallbackCondition === 'above'
              ? currentPrice >= targetValue - getPriceTolerance(targetValue)
              : false);
        const shouldTrigger = touchedTarget || crossedTarget || legacyDirectionHit;

        if (shouldTrigger) {
          if (crossedTarget && Number.isFinite(previousPrice)) {
            console.log(
              `[Alert ${alert.id}] Price crossed target: ${previousPrice} -> ${currentPrice} (target: ${targetValue})`
            );
          } else if (legacyDirectionHit) {
            console.log(
              `[Alert ${alert.id}] Price reached target via legacy condition fallback: ${currentPrice} (target: ${targetValue})`
            );
          } else {
            console.log(
              `[Alert ${alert.id}] Price touched target: ${currentPrice} (target: ${targetValue})`
            );
          }
        }
        // pct_change could be added later using initialPrices or klines

        if (!shouldTrigger) {
          priceAlertLastObserved.set(alert.id, currentPrice);
          continue;
        }

        priceAlertLastObserved.delete(alert.id);

        const resolvedCondition = hasValidInitialPrice
          ? (initialPrice > targetValue ? 'below' : 'above')
          : (String(alert.condition || '').toLowerCase() === 'below' ? 'below' : 'above');

        // For price alerts: DELETE from database when triggered (self-delete)
        // Store alert data before deletion for socket payload
        const alertDataBeforeDelete = {
          id: alert.id,
          name: alert.name,
          description: alert.description ?? null,
          triggered: true,
          triggeredAt: new Date(),
          currentPrice,
          targetValue: alert.targetValue,
          condition: resolvedCondition,
          coinSymbol: alert.coinSymbol ?? firstSymbol.replace(/USDT$/i, ''),
          symbol: firstSymbol,
          alertType: 'price',
          ...(alert.initialPrice != null && Number.isFinite(alert.initialPrice)
            ? { initialPrice: alert.initialPrice }
            : {}),
        };

        // Delete the alert from database
        await prisma.alert.delete({
          where: { id: alert.id },
        });

        if (alert.condition === 'pct_change') {
          clearInitialPrice(alert.id);
        }

        const payload = {
          id: alertDataBeforeDelete.id,
          alertId: alertDataBeforeDelete.id,
          ...alertDataBeforeDelete,
        };

        socketService.emitAlertTriggered(alert.userId, payload);
        await sendAlertToTelegram(alert.userId, payload);
        console.log(`Price alert ${alert.id} triggered and deleted for user ${alert.userId}`);
      }
    }

    // ---- Complex alerts: sharp movement in user timeframe ----
    const complexAlerts = activeAlerts.filter((a) => a.alertType === 'complex');
    
    if (complexAlerts.length > 0) {
      const nowMs = Date.now();
      let maxLookbackSec = 60;
      
      // Step 1: Collect symbols per (exchange, market) and max timeframe.
      const symbolsByExchangeMarket = new Map(); // key 'exchange|market' -> Set(symbol)
      
      for (const alert of complexAlerts) {
        const ex = (alert.exchange || 'binance').toLowerCase();
        const market = (alert.market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
        const notifOptions = parseNotificationOptions(alert.notificationOptions);
        const alertForMode = notifOptions.alertForMode || 'whitelist';
        
        let syms = parseSymbols(alert.symbols).map((s) => {
          const sUpper = String(s || '').toUpperCase().trim();
          if (!sUpper) return '';
          if (!sUpper.endsWith('USDT') && !sUpper.endsWith('USD') && !sUpper.includes('/')) {
            return sUpper + 'USDT';
          }
          return sUpper;
        }).filter(Boolean);
        
        if (alertForMode === 'all' && syms.length === 0) {
          try {
            const fetchActive =
              ex === 'bybit'
                ? bybitService.fetchActiveSymbols
                : ex === 'okx'
                  ? okxService.fetchActiveSymbols
                  : ex === 'gate'
                    ? gateService.fetchActiveSymbols
                    : ex === 'mexc'
                      ? mexcService.fetchActiveSymbols
                      : ex === 'bitget'
                        ? bitgetService.fetchActiveSymbols
                        : binanceService.fetchActiveSymbols;
            const activeSymbols = await fetchActive(market);
            if (activeSymbols && activeSymbols.size > 0) {
              syms = Array.from(activeSymbols).filter(s => s.endsWith('USDT')).map(s => s.toUpperCase());
            }
          } catch (error) {
            console.error(`[alertEngine] Failed to fetch active symbols for ${ex}/${market}:`, error.message);
          }
        }
        
        const key = `${ex}|${market}`;
        if (!symbolsByExchangeMarket.has(key)) symbolsByExchangeMarket.set(key, new Set());
        syms.forEach(s => symbolsByExchangeMarket.get(key).add(s));

        const conds = parseConditions(alert.conditions);
        for (const c of conds) {
          if (c?.type !== 'pct_change') continue;
          const sec = parseTimeframeSeconds(c.timeframe);
          if (Number.isFinite(sec) && sec > maxLookbackSec) maxLookbackSec = sec;
        }
      }
      
      // Step 2: Fetch prices per (exchange, market) and append to that exchange's history.
      const pricesByKey = {};
      for (const [key, symbolSet] of symbolsByExchangeMarket.entries()) {
        const [exchange, market] = key.split('|');
        const symbols = [...symbolSet];
        if (symbols.length === 0) {
          pricesByKey[key] = {};
          continue;
        }
        
        const needsAllCoins = complexAlerts.some(a => {
          const ex = (a.exchange || 'binance').toLowerCase();
          const alertMarket = (a.market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
          const notifOptions = parseNotificationOptions(a.notificationOptions);
          return (notifOptions.alertForMode || 'whitelist') === 'all' && ex === exchange && alertMarket === market;
        });
        
        const exchangeType = market === 'spot' ? 'spot' : 'futures';
        const getPrices =
          exchange === 'bybit'
            ? (symList) => bybitService.getLastPricesBySymbols(symList, exchangeType)
            : exchange === 'okx'
              ? (symList) => okxService.getLastPricesBySymbols(symList, exchangeType)
              : exchange === 'gate'
                ? (symList) => gateService.getLastPricesBySymbols(symList, exchangeType)
                : exchange === 'mexc'
                  ? (symList) => mexcService.getLastPricesBySymbols(symList, exchangeType)
                  : exchange === 'bitget'
                    ? (symList) => bitgetService.getLastPricesBySymbols(symList, exchangeType)
                    : (symList) => binanceService.getLastPricesBySymbols(symList, exchangeType);
        try {
          const prices = needsAllCoins ? await getPrices([]) : await getPrices(symbols);
          pricesByKey[key] = prices || {};
        } catch (err) {
          console.warn(`[alertEngine] Failed to fetch prices for ${key}:`, err.message);
          pricesByKey[key] = {};
        }
        appendComplexPricePoints(exchange, market, pricesByKey[key], nowMs, maxLookbackSec);
      }
      
      // Step 3: Evaluate each alert condition against window range stats.
      for (const alert of complexAlerts) {
        const ex = (alert.exchange || 'binance').toLowerCase();
        const market = (alert.market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
        const key = `${ex}|${market}`;
        const notifOptions = parseNotificationOptions(alert.notificationOptions);
        const alertForMode = notifOptions.alertForMode || 'whitelist';
        const conditions = parseConditions(alert.conditions);
        
        if (conditions.length === 0) continue;
        
        let syms = parseSymbols(alert.symbols).map((s) => {
          const sUpper = String(s || '').toUpperCase().trim();
          if (!sUpper) return '';
          if (!sUpper.endsWith('USDT') && !sUpper.endsWith('USD') && !sUpper.includes('/')) {
            return sUpper + 'USDT';
          }
          return sUpper;
        }).filter(Boolean);
        
        if (alertForMode === 'all' && syms.length === 0) {
          syms = Object.keys(pricesByKey[key] || {})
            .map((s) => s.toUpperCase())
            .filter((s) => s.endsWith('USDT'));
        }
        
        const priceMap = pricesByKey[key] || {};
        
        // Process each condition
        for (const cond of conditions) {
          if (cond.type !== 'pct_change' || cond.value == null) continue;
          
          const threshold = Math.abs(Number(cond.value));
          const timeframeSec = parseTimeframeSeconds(cond.timeframe);
          
          if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(timeframeSec) || timeframeSec <= 0) {
            continue;
          }
          
          // Check each symbol: trigger if span (max-min)/min in timeframe >= threshold.
          // Continue checking ALL symbols - don't stop after first trigger (cooldown prevents duplicates)
          for (const symbol of syms) {
            const symbolUpper = symbol.toUpperCase();

            // Symbol matching against price map keys (supports *.P futures aliases).
            const priceKeys = Object.keys(priceMap);
            let resolvedSymbol = null;
            const exact = priceKeys.find((k) => k.toUpperCase() === symbolUpper);
            if (exact) resolvedSymbol = exact.toUpperCase();
            if (!resolvedSymbol && market === 'futures' && symbolUpper.endsWith('USDT')) {
              const withP = `${symbolUpper}.P`;
              const p = priceKeys.find((k) => k.toUpperCase() === withP);
              if (p) resolvedSymbol = p.toUpperCase();
            }
            if (!resolvedSymbol && symbolUpper.endsWith('.P')) {
              const noP = symbolUpper.slice(0, -2);
              const p = priceKeys.find((k) => k.toUpperCase() === noP);
              if (p) resolvedSymbol = p.toUpperCase();
            }
            if (!resolvedSymbol) continue;

            const stats = getWindowStats(ex, market, resolvedSymbol, nowMs, timeframeSec);
            if (!stats) continue;

            const spanPct = ((stats.max - stats.min) / stats.min) * 100;
            if (syms.length <= 20 || spanPct >= threshold * 0.8) {
              console.log(
                `[alertEngine] Complex ${alert.id} ${resolvedSymbol}: ` +
                `window ${timeframeSec}s min=${stats.min.toFixed(6)} max=${stats.max.toFixed(6)} ` +
                `span=${spanPct.toFixed(2)}% need=${threshold}% points=${stats.points}`
              );
            }

            // Trigger condition: sharp move happened anywhere inside timeframe window.
            if (spanPct >= threshold) {
              if (!canEmitComplexTrigger(alert.id, resolvedSymbol, nowMs)) {
                continue; // Skip if cooldown active (60 seconds per symbol)
              }

              const pctChange = ((stats.current - stats.oldest) / stats.oldest) * 100;
              // TRIGGER! Continue checking other symbols after this trigger
              const updatedAlert = await prisma.alert.update({
                where: { id: alert.id },
                data: {
                  triggered: true,
                  triggeredAt: new Date(),
                  isActive: true, // Keep active for continuous monitoring
                },
              });
              markComplexTrigger(alert.id, resolvedSymbol, nowMs);
              
              const payload = {
                id: updatedAlert.id,
                alertId: updatedAlert.id,
                name: updatedAlert.name,
                description: updatedAlert.description ?? null,
                triggered: true,
                triggeredAt: updatedAlert.triggeredAt,
                alertType: 'complex',
                symbol: resolvedSymbol,
                pctChange: pctChange,
                baselinePrice: stats.oldest,
                currentPrice: stats.current,
                windowSeconds: timeframeSec,
              };
              
              socketService.emitAlertTriggered(updatedAlert.userId, payload);
              await sendAlertToTelegram(updatedAlert.userId, payload);
              console.log(
                `⚡⚡⚡ Complex alert ${alert.id} TRIGGERED: ${resolvedSymbol} ` +
                `span=${spanPct.toFixed(2)}% (threshold=${threshold}%) in ${timeframeSec}s. ` +
                `oldest=${stats.oldest.toFixed(6)} current=${stats.current.toFixed(6)}`
              );
              
              // Continue to next symbol - don't break! Alert should monitor all symbols continuously
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in alert engine:', error);
  }
}

function startAlertEngine() {
  if (alertEngineRunning) {
    console.warn('Alert engine is already running');
    return;
  }
  console.log('Starting alert engine...');
  cron.schedule('* * * * * *', () => checkAlerts());
  checkAlerts();
  alertEngineRunning = true;
  console.log('Alert engine started (checking every 1 second)');
}

function stopAlertEngine() {
  alertEngineRunning = false;
  console.log('Alert engine stopped');
}

module.exports = {
  startAlertEngine,
  stopAlertEngine,
  checkAlerts,
  setInitialPrice,
  clearInitialPrice,
};
