const axios = require('axios');
const prisma = require('../utils/prisma');
const { createAlertSchema, updateAlertSchema } = require('../utils/validators');
const priceService = require('../services/priceService');
const { setInitialPrice, clearInitialPrice, getEngineStatus } = require('../services/alertEngine');
const { fetchExchangePriceSnapshot } = require('../services/priceSourceResolver');
const { processPriceAlerts } = require('../services/priceAlertEngine');
const socketService = require('../services/socketService');
const telegramService = require('../services/telegramService');

// ---------------------------------------------------------------------------
// Helpers used by historical klines trigger check
// ---------------------------------------------------------------------------

function parseAlertSymbols(symbols) {
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

/** Re-derive directed condition from stored initialPrice vs targetValue (same logic as priceAlertEngine). */
function resolveConditionFromAlert(alert) {
  const initial = Number(alert?.initialPrice);
  const target = Number(alert?.targetValue);
  if (Number.isFinite(initial) && initial > 0 && Number.isFinite(target) && target > 0) {
    if (initial > target) return 'below';
    if (initial < target) return 'above';
  }
  return String(alert?.condition || '').toLowerCase() === 'below' ? 'below' : 'above';
}

/**
 * Fetch 1-minute OHLC candles from the relevant exchange since startTimeMs.
 * Returns array of { high, low } objects.  Falls back to [] on any error so the
 * caller (checkAlertHistorically) can degrade gracefully.
 */
async function fetchKlinesForHistoricalCheck(exchange, market, symbol, startTimeMs) {
  const isFutures = String(market || 'futures').toLowerCase() !== 'spot';
  const sym = String(symbol || '').toUpperCase();
  const endTimeMs = Date.now();
  const TIMEOUT = 8000;

  // Sliding window: always check the most recent 8 hours of 1-min candles (≤ 480 candles).
  // For young alerts (< 8h old) we start from creation; for older alerts we use
  // now - 8h so we never miss the Render free-tier sleep gap (max ~15 min).
  //
  // IMPORTANT: Round UP to the next 1-minute boundary so we skip the partial
  // candle that contains the alert-creation timestamp.  That candle's high/low
  // can include pre-creation price data (e.g. a spike that already reverted by
  // the time the user created the alert), which would cause a false trigger.
  const LOOKBACK_MS = 8 * 60 * 60 * 1000; // 8 hours
  const CANDLE_MS = 60_000; // 1-minute candles
  const nextCandleBoundary = Math.ceil(startTimeMs / CANDLE_MS) * CANDLE_MS;
  const effectiveStartMs = Math.max(nextCandleBoundary, endTimeMs - LOOKBACK_MS);

  try {
    if (exchange === 'bybit') {
      const category = isFutures ? 'linear' : 'spot';
      const resp = await axios.get('https://api.bybit.com/v5/market/kline', {
        params: { category, symbol: sym, interval: '1', start: effectiveStartMs, end: endTimeMs, limit: 500 },
        timeout: TIMEOUT,
      });
      const list = resp.data?.result?.list || [];
      // Bybit kline: [startTime, open, high, low, close, volume, turnover]
      return list.map((k) => ({ high: Number(k[2]), low: Number(k[3]) }));
    }

    if (exchange === 'okx') {
      const base = sym.replace(/USDT$/i, '');
      const instId = isFutures ? `${base}-USDT-SWAP` : `${base}-USDT`;
      // OKX candles endpoint: `after` = return candles with ts < after (descending).
      // We request limit=300 going back from endTimeMs which covers the last 5 hours at 1m.
      const resp = await axios.get('https://www.okx.com/api/v5/market/candles', {
        params: { instId, bar: '1m', after: String(endTimeMs), limit: '300' },
        timeout: TIMEOUT,
      });
      const data = resp.data?.data || [];
      // OKX candle: [ts, open, high, low, close, ...] — filter to effectiveStartMs window
      return data
        .filter((k) => Number(k[0]) >= effectiveStartMs)
        .map((k) => ({ high: Number(k[2]), low: Number(k[3]) }));
    }

    if (exchange === 'gate') {
      if (isFutures) {
        const contract = `${sym.replace(/USDT$/i, '')}_USDT`;
        const resp = await axios.get('https://fx-api.gateio.ws/api/v4/futures/usdt/candlesticks', {
          params: { contract, interval: '1m', from: Math.floor(effectiveStartMs / 1000), to: Math.floor(endTimeMs / 1000), limit: 500 },
          timeout: TIMEOUT,
        });
        return (Array.isArray(resp.data) ? resp.data : []).map((k) => ({ high: Number(k.h), low: Number(k.l) }));
      } else {
        // Gate spot klines
        const currencyPair = `${sym.replace(/USDT$/i, '')}_USDT`;
        const resp = await axios.get('https://api.gateio.ws/api/v4/spot/candlesticks', {
          params: { currency_pair: currencyPair, interval: '1m', from: Math.floor(effectiveStartMs / 1000), to: Math.floor(endTimeMs / 1000), limit: 500 },
          timeout: TIMEOUT,
        });
        // Gate spot candle: [ts, volume, close, high, low, open, ...]
        return (Array.isArray(resp.data) ? resp.data : []).map((k) => ({ high: Number(k[3]), low: Number(k[4]) }));
      }
    }

    if (exchange === 'mexc') {
      if (isFutures) {
        const contract = `${sym.replace(/USDT$/i, '')}_USDT`;
        const resp = await axios.get(`https://futures.mexc.com/api/v1/contract/kline/${contract}`, {
          params: { interval: 'Min1', start: Math.floor(effectiveStartMs / 1000), end: Math.floor(endTimeMs / 1000) },
          timeout: TIMEOUT,
        });
        const highs = resp.data?.data?.highPrices || [];
        const lows = resp.data?.data?.lowPrices || [];
        return highs.map((h, i) => ({ high: Number(h), low: Number(lows[i] ?? h) }));
      } else {
        // MEXC spot klines (standard REST v3)
        const resp = await axios.get('https://api.mexc.com/api/v3/klines', {
          params: { symbol: sym, interval: '1m', startTime: effectiveStartMs, endTime: endTimeMs, limit: 500 },
          timeout: TIMEOUT,
        });
        // MEXC spot kline: [openTime, open, high, low, close, ...]
        return (Array.isArray(resp.data) ? resp.data : []).map((k) => ({ high: Number(k[2]), low: Number(k[3]) }));
      }
    }

    if (exchange === 'bitget') {
      const productType = isFutures ? 'USDT-FUTURES' : 'SPOT';
      const bitgetSym = isFutures ? `${sym}` : sym; // POWERUSDT, BTCUSDT etc.
      const resp = await axios.get('https://api.bitget.com/api/v2/mix/market/history-candles', {
        params: { symbol: bitgetSym, productType, granularity: '1m', startTime: String(effectiveStartMs), endTime: String(endTimeMs), limit: '500' },
        timeout: TIMEOUT,
      });
      const list = Array.isArray(resp.data?.data) ? resp.data.data : [];
      // Bitget candle: [ts, open, high, low, close, vol, ...]
      return list.map((k) => ({ high: Number(k[2]), low: Number(k[3]) }));
    }

    // Default: Binance
    const baseUrl = isFutures ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
    const resp = await axios.get(`${baseUrl}/klines`, {
      params: { symbol: sym, interval: '1m', startTime: effectiveStartMs, endTime: endTimeMs, limit: 500 },
      timeout: TIMEOUT,
    });
    // Binance kline: [openTime, open, high, low, close, vol, closeTime, ...]
    return (Array.isArray(resp.data) ? resp.data : []).map((k) => ({ high: Number(k[2]), low: Number(k[3]) }));
  } catch (error) {
    console.warn(`[fetchKlinesForHistoricalCheck] ${exchange}/${market}/${sym} failed:`, error?.message);
    return [];
  }
}

/**
 * Check if a price alert should have triggered historically (e.g. while the
 * server was sleeping on Render free tier).  Fetches 1-min OHLC candles since
 * the alert was created and checks whether the price ever crossed the target.
 * If yes, atomically marks the alert as triggered in the DB and returns the
 * payload; returns null otherwise.
 *
 * TradingView-style crossing detection:
 *   • For 'above': initialPrice < target — we look for a candle whose HIGH >= target.
 *   • For 'below': initialPrice > target — we look for a candle whose LOW <= target.
 *   • Crossing guard: if initialPrice is already on the target side, skip immediately.
 *     This makes the 60-second candle-offset UNNECESSARY — the crossing guard already
 *     prevents false positives from any candle that includes pre-creation data.
 *     We start from createdAtMs directly so crossings in the first minute are caught.
 */
async function checkAlertHistorically(alert) {
  const symbols = parseAlertSymbols(alert.symbols);
  const symbol = symbols[0];
  if (!symbol) return null;

  const targetValue = Number(alert.targetValue);
  if (!Number.isFinite(targetValue) || targetValue <= 0) return null;

  const condition = resolveConditionFromAlert(alert);
  const exchange = String(alert.exchange || 'binance').toLowerCase();
  const market = String(alert.market || 'futures').toLowerCase();

  // Crossing guard: require a valid initialPrice AND verify it started on
  // the correct side of target.  Without initialPrice we cannot prove a
  // crossing occurred, so we refuse to trigger (conservative approach).
  const initial = Number(alert?.initialPrice);
  if (!Number.isFinite(initial) || initial <= 0) return null; // no proof of crossing
  if (condition === 'above' && initial >= targetValue) return null; // was already above — no crossing possible
  if (condition === 'below' && initial <= targetValue) return null; // was already below — no crossing possible

  // Minimum age: 15 seconds.  Gives the 300ms real-time engine ~50 cycles to
  // catch it first.  The crossing guard above already prevents false positives,
  // so we don't need a long blackout.  Keeping it at 15s avoids stale-kline
  // issues immediately after alert creation.
  const createdAtMs = alert.createdAt ? new Date(alert.createdAt).getTime() : 0;
  if (Date.now() - createdAtMs < 15_000) return null;

  // Fetch klines from alert creation time (not +60s — crossing guard handles false positives).
  const klines = await fetchKlinesForHistoricalCheck(exchange, market, symbol, createdAtMs);
  // Market-type fallback: if the stored market (e.g. 'futures') has no klines for
  // this symbol, try the other market type.  Handles tokens that are spot-only.
  let effectiveMarket = market;
  let resolvedKlines = klines;
  if (!klines.length) {
    const altMarket = market === 'futures' ? 'spot' : 'futures';
    const altKlines = await fetchKlinesForHistoricalCheck(exchange, altMarket, symbol, createdAtMs);
    if (altKlines.length) {
      resolvedKlines = altKlines;
      effectiveMarket = altMarket;
      // Self-heal: correct the stored market so future sweeps/engine cycles are direct.
      try {
        await prisma.alert.updateMany({
          where: { id: alert.id, triggered: false, isActive: true },
          data: { market: altMarket },
        });
        console.log(`[checkAlertHistorically] alert=${alert.id} market auto-corrected ${market} → ${altMarket}`);
      } catch { /* non-fatal */ }
    }
  }
  if (!resolvedKlines.length) return null;

  let crossed = false;
  for (const { high, low } of resolvedKlines) {
    if (condition === 'above' && Number.isFinite(high) && high >= targetValue) { crossed = true; break; }
    if (condition === 'below' && Number.isFinite(low) && low <= targetValue) { crossed = true; break; }
  }
  if (!crossed) return null;

  // Use ONE timestamp for both the DB write and the returned payload so that the
  // deduplication key produced by applyTriggeredEvent matches across sweptTriggers
  // and pendingNotifications (which returns the same DB-stored value).
  const triggeredAt = new Date();

  // Atomically mark triggered — prevents double-fire with the background engine.
  const updateResult = await prisma.alert.updateMany({
    where: { id: alert.id, triggered: false, isActive: true },
    data: { triggered: true, isActive: false, triggeredAt },
  });
  if (updateResult.count === 0) return null; // already handled elsewhere

  console.log(`[checkAlertHistorically] TRIGGERED alert=${alert.id} ${symbol} ${condition} ${targetValue} (historical klines)`);

  const coinSymbol = (typeof alert.coinSymbol === 'string' && alert.coinSymbol.trim())
    ? alert.coinSymbol
    : symbol.replace(/USDT$/i, '').replace(/USD$/i, '');

  return {
    id: alert.id,
    alertId: alert.id,
    name: alert.name,
    description: alert.description ?? null,
    triggered: true,
    triggeredAt,
    currentPrice: targetValue,
    targetValue: alert.targetValue,
    condition,
    coinSymbol,
    symbol,
    exchange,
    market,
    alertType: 'price',
    priceSource: `historical_${exchange}_klines`,
    ...(alert.initialPrice != null && Number.isFinite(Number(alert.initialPrice))
      ? { initialPrice: Number(alert.initialPrice) } : {}),
  };
}

async function sendAlertToTelegram(userId, payload) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });
    if (!user?.telegramChatId) return;

    const symbol = payload?.coinSymbol || payload?.symbol || 'symbol';
    const target = Number(payload?.targetValue);
    const current = Number(payload?.currentPrice);
    const targetStr = Number.isFinite(target) ? target.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—';
    const currentStr = Number.isFinite(current) ? current.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—';
    const condition = payload?.condition === 'below' ? 'below' : 'above';

    const message = `${payload?.name || 'Price alert'}\n${symbol}\nPrice hit ${condition} ${targetStr} (current: ${currentStr})`;
    await telegramService.sendMessage(user.telegramChatId, message);
  } catch (error) {
    console.warn('[alertController] sendAlertToTelegram failed:', error?.message);
  }
}

async function sweepUserPriceAlerts(userId) {
  if (!userId) return [];

  try {
    const priceAlerts = await prisma.alert.findMany({
      where: {
        userId,
        isActive: true,
        triggered: false,
        alertType: 'price',
      },
    });

    if (!Array.isArray(priceAlerts) || priceAlerts.length === 0) {
      return [];
    }

    const triggeredPayloads = [];
    const triggeredIds = new Set();

    // --- Pass 1: current live price check ---
    await processPriceAlerts(priceAlerts, {
      logger: console,
      onDeleted: async (alert) => {
        if (alert.condition === 'pct_change') clearInitialPrice(alert.id);
      },
      onTriggered: async (alert, payload) => {
        triggeredIds.add(alert.id);
        triggeredPayloads.push(payload);
        socketService.emitAlertTriggered(alert.userId, payload);
        await sendAlertToTelegram(alert.userId, payload);
      },
    });

    // --- Pass 2: historical klines check for alerts current price didn't catch ---
    // This catches cases where the server was sleeping (Render free-tier) when the
    // price spike occurred and the price has since reverted.
    const unchecked = priceAlerts.filter((a) => !triggeredIds.has(a.id));
    await Promise.allSettled(
      unchecked.map(async (alert) => {
        try {
          const payload = await checkAlertHistorically(alert);
          if (!payload) return;
          triggeredIds.add(alert.id);
          triggeredPayloads.push(payload);
          socketService.emitAlertTriggered(alert.userId, payload);
          await sendAlertToTelegram(alert.userId, payload);
        } catch (error) {
          console.warn('[sweepUserPriceAlerts] historical check error alert=' + alert.id + ':', error?.message);
        }
      })
    );

    return triggeredPayloads;
  } catch (error) {
    console.warn('[alertController] sweepUserPriceAlerts failed:', error?.message);
    return [];
  }
}

/** Derive coinSymbol and coinId from first symbol (e.g. BTCUSDT -> BTC, btc) */
function deriveLegacyFromFirstSymbol(symbols) {
  const arr = Array.isArray(symbols) ? symbols : symbols ? [symbols] : [];
  const first = arr[0];
  if (!first || typeof first !== 'string') return { coinSymbol: '', coinId: '' };
  const base = first.replace(/USDT$/i, '').replace(/USD$/i, '') || first;
  return { coinSymbol: base, coinId: base.toLowerCase() };
}

function parseSymbolsInput(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
      if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    } catch {
      return [trimmed];
    }
    return [trimmed];
  }
  return [];
}

function buildCanonicalCreateBody(input) {
  const body = { ...input };
  if (body.type != null && body.alertType == null) body.alertType = body.type;
  if (body.priceCondition != null && body.condition == null) body.condition = body.priceCondition;

  if (Array.isArray(body.exchanges) && body.exchanges.length > 0) {
    const firstExchange = String(body.exchanges[0] || '').trim().toLowerCase();
    if (!firstExchange) {
      body.exchanges = [];
    } else {
      body.exchanges = [firstExchange];
      if (body.exchange == null) body.exchange = firstExchange;
    }
  }

  if (body.exchange != null) body.exchange = String(body.exchange).trim().toLowerCase();
  if (body.market != null) body.market = String(body.market).trim().toLowerCase();
  if (body.alertType == null) body.alertType = 'price';

  const parsedSymbols = parseSymbolsInput(body.symbols);
  const symbolFromField = body.symbol != null ? String(body.symbol).trim().toUpperCase() : '';
  const symbolFromArray = parsedSymbols.length > 0 ? String(parsedSymbols[0]).trim().toUpperCase() : '';

  if (String(body.alertType).toLowerCase() === 'price') {
    body.symbol = symbolFromField || symbolFromArray || undefined;
    if (body.symbol) {
      body.symbols = [body.symbol];
    } else {
      body.symbols = [];
    }
  } else {
    body.symbol = symbolFromField || undefined;
    body.symbols = parsedSymbols;
  }

  if (body.conditions != null && body.conditions !== '') {
    body.conditions = typeof body.conditions === 'string' ? body.conditions : JSON.stringify(body.conditions);
  }

  if (body.notificationOptions != null) {
    body.notificationOptions = typeof body.notificationOptions === 'string' ? body.notificationOptions : JSON.stringify(body.notificationOptions);
  }

  if (body.targetValue !== undefined && body.targetValue !== null && body.targetValue !== '') {
    const n = typeof body.targetValue === 'number' ? body.targetValue : parseFloat(body.targetValue);
    body.targetValue = Number.isFinite(n) ? n : undefined;
  } else {
    body.targetValue = undefined;
  }

  if (body.currentPrice !== undefined && body.currentPrice !== null && body.currentPrice !== '') {
    const n = typeof body.currentPrice === 'number' ? body.currentPrice : parseFloat(body.currentPrice);
    body.currentPrice = Number.isFinite(n) ? n : undefined;
  } else {
    body.currentPrice = undefined;
  }

  return { body, symbolFromField, symbolFromArray };
}

function buildImmediateTriggerPayload(alert, currentPrice) {
  const triggeredAt = new Date();
  const symbol = Array.isArray(alert.symbols) && alert.symbols.length > 0
    ? alert.symbols[0]
    : (typeof alert.symbols === 'string' ? alert.symbols : alert.coinSymbol || '');

  return {
    id: alert.id,
    alertId: alert.id,
    name: alert.name,
    description: alert.description ?? null,
    triggered: true,
    triggeredAt,
    currentPrice,
    targetValue: alert.targetValue,
    condition: alert.condition,
    coinSymbol: alert.coinSymbol,
    symbol,
    exchange: alert.exchange,
    market: alert.market,
    alertType: 'price',
    initialPrice: alert.initialPrice,
  };
}

/**
 * Get user's alerts
 * Query params: status (active|triggered|all), exchange, market, type (alertType)
 * Returns { alerts } — frontend should use response.data.alerts
 */
async function getAlerts(req, res, next) {
  try {
    const { status, exchange, market, type } = req.query;
    const userId = req.user.id;

    // Synchronous sweep: await so the triggered payloads are included in THIS
    // HTTP response.  The client gets swept triggers immediately instead of
    // waiting for the next 30/60-second poll cycle.
    // • Pass 1: live price check — if price is AT target right now, atom-mark triggered, emit socket.
    // • Pass 2: historical klines check — catches spikes that happened while the server
    //   was sleeping on Render free tier (max ~15 min gap).
    // Socket events are ALSO emitted inside the sweep, so connected clients see them
    // in real time even if this HTTP response is slower.
    let sweptTriggers = [];
    if (status !== 'triggered') {
      try {
        sweptTriggers = await sweepUserPriceAlerts(userId);
      } catch (e) {
        console.warn('[getAlerts] sweep error:', e?.message);
      }
    }

    const where = { userId };

    // Status filter: active (in work), triggered (archived), or all
    if (status === 'active') {
      where.isActive = true;
      // Price alerts are one-shot (triggered=false only).
      // Complex alerts remain active even after trigger and must stay visible in "active".
      where.OR = [
        { triggered: false },
        { alertType: 'complex', triggered: true },
      ];
    } else if (status === 'triggered') {
      where.triggered = true;
    }
    // status === 'all' or omitted: no isActive/triggered filter

    if (exchange != null && exchange !== '' && exchange !== 'all') {
      where.exchange = exchange;
    }
    if (market != null && market !== '' && market !== 'all') {
      where.market = market;
    }
    if (type != null && type !== '' && type !== 'all') {
      where.alertType = type;
    }

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Include recently-triggered price alerts so the client can show a notification even
    // when the socket event was missed (race condition, disconnect, cold start, or
    // server was sleeping when engine ran the historical klines check).
    // 4-hour window covers Render sleep gaps plus time for user to return to app.
    // The client deduplicates using processedTriggerKeys, so this only fires once per session.
    const FOUR_HOURS_AGO = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const pendingNotifications = await prisma.alert.findMany({
      where: {
        userId,
        alertType: 'price',
        triggered: true,
        isActive: false,
        triggeredAt: { gte: FOUR_HOURS_AGO },
      },
      orderBy: { triggeredAt: 'desc' },
      take: 20,
    });

    res.json({ alerts, sweptTriggers, pendingNotifications });
  } catch (error) {
    next(error);
  }
}

/**
 * Create new alert
 * Validate with createAlertSchema; map to Prisma (new + legacy fields).
 * Returns { alert } — frontend uses response.data.alert
 */
async function createAlert(req, res, next) {
  console.log('[createAlert] ===== START =====');
  console.log('[createAlert] Incoming request body:', JSON.stringify(req.body, null, 2));
  console.log('[createAlert] User ID:', req.user?.id);
  console.log('[createAlert] Request headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    const { body, symbolFromField, symbolFromArray } = buildCanonicalCreateBody(req.body);

    if (symbolFromField && symbolFromArray && symbolFromField !== symbolFromArray) {
      return res.status(400).json({
        error: 'Ambiguous symbol payload. Provide only one symbol for price alerts.',
      });
    }

    if (body.exchange && Array.isArray(req.body?.exchanges) && req.body.exchanges.length > 0) {
      const firstIncomingExchange = String(req.body.exchanges[0] || '').trim().toLowerCase();
      if (firstIncomingExchange && String(body.exchange).toLowerCase() !== firstIncomingExchange) {
        return res.status(400).json({
          error: 'Ambiguous exchange payload. Provide only one exchange for price alerts.',
        });
      }
    }

    console.log('[createAlert] Normalized body after coercion:', JSON.stringify(body, null, 2));
    
    const validatedData = createAlertSchema.parse(body);
    console.log('[createAlert] Validation successful. Validated data:', JSON.stringify({
      alertType: validatedData.alertType,
      name: validatedData.name,
      exchange: validatedData.exchange,
      market: validatedData.market,
      symbolsCount: Array.isArray(validatedData.symbols) ? validatedData.symbols.length : (validatedData.symbols ? 1 : 0),
      hasConditions: !!validatedData.conditions,
      hasNotificationOptions: !!validatedData.notificationOptions,
      condition: validatedData.condition,
      targetValue: validatedData.targetValue,
    }, null, 2));
    
    const userId = req.user.id;
    console.log('[createAlert] User ID:', userId);

    let symbolsForStorage =
      validatedData.symbols != null
        ? (Array.isArray(validatedData.symbols) ? validatedData.symbols : [validatedData.symbols])
        : null;
    const conditionsStr =
      validatedData.conditions != null && validatedData.conditions !== ''
        ? typeof validatedData.conditions === 'string'
          ? validatedData.conditions
          : JSON.stringify(validatedData.conditions)
        : null;
    const notificationOptionsStr =
      validatedData.notificationOptions != null
        ? typeof validatedData.notificationOptions === 'string'
          ? validatedData.notificationOptions
          : JSON.stringify(validatedData.notificationOptions)
        : null;

    let coinId = validatedData.coinId ?? '';
    let coinSymbol = validatedData.coinSymbol ?? '';
    let condition = validatedData.condition ?? 'above';
    let targetValue = validatedData.targetValue ?? 0;

    if (validatedData.alertType === 'price') {
      const hasLegacy = validatedData.coinId && validatedData.coinSymbol && validatedData.condition != null && validatedData.targetValue != null;
      if (!hasLegacy && validatedData.symbols != null) {
        const derived = deriveLegacyFromFirstSymbol(validatedData.symbols);
        if (derived.coinSymbol) coinSymbol = derived.coinSymbol;
        if (derived.coinId) coinId = derived.coinId;
        condition = validatedData.condition ?? 'above';
        targetValue = validatedData.targetValue ?? 0;
      }
    } else {
      coinId = 'n/a';
      coinSymbol = '';
      condition = 'above';
      targetValue = 0;
    }

    // Price alerts baseline: exchange snapshot first, client snapshot only fallback.
    let initialPrice = null;
    let initialPriceSource = null;
    const clientProvidedInitialPrice = Number(validatedData.currentPrice);
    const exchange = (validatedData.exchange || 'binance').toLowerCase();

    if (validatedData.alertType === 'price' && validatedData.symbols != null) {
      const syms = Array.isArray(validatedData.symbols) ? validatedData.symbols : [validatedData.symbols];
      const firstSymbolRaw = syms[0];
      const market = (validatedData.market || 'futures').toLowerCase();

      if (firstSymbolRaw && typeof firstSymbolRaw === 'string') {
        const snapshot = await fetchExchangePriceSnapshot({
          exchange,
          market,
          symbol: firstSymbolRaw,
          strict: true,
          logger: console,
        });

        const normalizedSymbol = String(snapshot?.symbol || '').toUpperCase();
        if (Array.isArray(symbolsForStorage) && symbolsForStorage.length > 0) {
          symbolsForStorage = [normalizedSymbol || String(firstSymbolRaw).toUpperCase(), ...symbolsForStorage.slice(1)];
        }

        if (!normalizedSymbol) {
          return res.status(400).json({
            error: 'Invalid symbol format. Cannot fetch current price.',
            details: { symbol: firstSymbolRaw },
          });
        }

        if (snapshot?.ok && Number.isFinite(Number(snapshot.price)) && Number(snapshot.price) > 0) {
          initialPrice = Number(snapshot.price);
          initialPriceSource = snapshot.source || `${exchange}_exchange_map`;
          console.log('[createAlert] Initial price resolved from exchange snapshot:', {
            exchange,
            symbol: normalizedSymbol,
            market,
            initialPrice,
            initialPriceSource,
          });
          // If the price was found via the fallback market type (e.g. user picked
          // 'futures' but ENSO only exists on spot), override the stored market so
          // the engine polls the correct market from day one.
          if (snapshot.resolvedMarket && snapshot.resolvedMarket !== market) {
            console.warn(`[createAlert] market auto-corrected ${market} → ${snapshot.resolvedMarket} because symbol only exists on ${snapshot.resolvedMarket}`);
            if (validatedData) validatedData.market = snapshot.resolvedMarket;
          }
        } else {
          if (Number.isFinite(clientProvidedInitialPrice) && clientProvidedInitialPrice > 0) {
            initialPrice = clientProvidedInitialPrice;
            initialPriceSource = 'client_fallback';
            console.warn('[createAlert] Exchange snapshot unavailable, using client fallback:', {
              exchange,
              symbol: normalizedSymbol,
              market,
              initialPrice,
              snapshotSource: snapshot?.source,
              snapshotError: snapshot?.error,
            });
          } else {
            return res.status(503).json({
              error: `Failed to fetch current price from ${exchange}.`,
              details: {
                exchange,
                symbol: firstSymbolRaw,
                normalizedSymbol,
                market,
                snapshotSource: snapshot?.source,
                snapshotError: snapshot?.error,
              },
            });
          }
        }
      } else {
        return res.status(400).json({
          error: 'Invalid symbol provided for price alert.',
          details: { symbol: firstSymbolRaw },
        });
      }
    }
    
    // For price alerts, initialPrice MUST be set (we already validated above)
    if (validatedData.alertType === 'price' && (initialPrice == null || !Number.isFinite(initialPrice))) {
      return res.status(400).json({
        error: 'Initial price is required for price alerts but could not be determined.',
        details: { alertType: 'price', initialPrice }
      });
    }

    // Auto-determine direction for price alerts from creation-time snapshot.
    // For price alerts we do NOT trust incoming condition; direction is derived from initialPrice vs targetValue.
    if (validatedData.alertType === 'price') {
      const numericTargetValue = Number(targetValue);
      if (!Number.isFinite(numericTargetValue) || numericTargetValue <= 0) {
        return res.status(400).json({
          error: 'Target price must be a valid number greater than 0.',
          details: { targetValue },
        });
      }
      targetValue = numericTargetValue;

      // initialPrice is required and validated above, so it must exist here
      if (initialPrice == null || !Number.isFinite(initialPrice)) {
        return res.status(500).json({
          error: 'Internal error: initialPrice validation failed.',
        });
      }

      const PRICE_TOLERANCE = 1e-8;
      const delta = initialPrice - targetValue;

      condition = delta > 0 ? 'below' : 'above';
      console.log('[createAlert] Direction resolved from snapshot:', {
        initialPrice,
        targetValue,
        condition,
        initialPriceSource,
      });

      const shouldTriggerImmediately = Math.abs(delta) <= PRICE_TOLERANCE;
      if (shouldTriggerImmediately) {
        const immediateAlert = await prisma.alert.create({
          data: {
            userId,
            name: validatedData.name,
            exchange: validatedData.exchange ?? 'binance',
            market: validatedData.market ?? 'futures',
            alertType: validatedData.alertType,
            description: validatedData.description ?? null,
            symbols: symbolsForStorage != null ? JSON.stringify(symbolsForStorage) : null,
            conditions: conditionsStr,
            notificationOptions: notificationOptionsStr,
            coinId,
            coinSymbol,
            condition,
            targetValue,
            isActive: false,
            triggered: true,
            triggeredAt: new Date(),
            ...(initialPrice != null && Number.isFinite(initialPrice) ? { initialPrice } : {}),
          },
        });

        const immediatePayload = buildImmediateTriggerPayload(immediateAlert, initialPrice);
        socketService.emitAlertTriggered(userId, immediatePayload);
        await sendAlertToTelegram(userId, immediatePayload);

        return res.status(201).json({
          alert: immediateAlert,
          immediateTrigger: true,
          transition: {
            from: 'create',
            to: 'triggered',
            reason: 'equal_at_create',
          },
        });
      }
    }

    const createData = {
      userId,
      name: validatedData.name,
      exchange: validatedData.exchange ?? 'binance',
      market: validatedData.market ?? 'futures',
      alertType: validatedData.alertType,
      description: validatedData.description ?? null,
      symbols: symbolsForStorage != null ? JSON.stringify(symbolsForStorage) : null,
      conditions: conditionsStr,
      notificationOptions: notificationOptionsStr,
      coinId,
      coinSymbol,
      condition, // Auto-determined for price alerts based on initialPrice vs targetValue
      targetValue,
      isActive: true,
      triggered: false,
      ...(initialPrice != null && Number.isFinite(initialPrice) ? { initialPrice } : {}),
    };
    
    console.log('[createAlert] createData object before Prisma create:', JSON.stringify({
      ...createData,
      symbols: createData.symbols ? (typeof createData.symbols === 'string' ? `[string length: ${createData.symbols.length}]` : createData.symbols) : null,
      conditions: createData.conditions ? (typeof createData.conditions === 'string' ? `[string length: ${createData.conditions.length}]` : createData.conditions) : null,
      notificationOptions: createData.notificationOptions ? (typeof createData.notificationOptions === 'string' ? `[string length: ${createData.notificationOptions.length}]` : createData.notificationOptions) : null,
    }, null, 2));
    console.log('[createAlert] createData keys:', Object.keys(createData));
    
    console.log('[createAlert] Calling prisma.alert.create...');
    const alert = await prisma.alert.create({
      data: createData,
    });
    console.log('[createAlert] Alert created successfully:', { id: alert.id, name: alert.name, alertType: alert.alertType });

    console.log('[createAlert] ===== SUCCESS =====');
    res.status(201).json({
      alert,
      immediateTrigger: false,
      transition: {
        from: 'create',
        to: 'active',
      },
    });
  } catch (error) {
    console.error('[createAlert] ===== ERROR CAUGHT =====');
    console.error('[createAlert] Error name:', error?.name);
    console.error('[createAlert] Error message:', error?.message);
    console.error('[createAlert] Error constructor:', error?.constructor?.name);
    console.error('[createAlert] Full error object:', error);
    console.error('[createAlert] Full stack trace:', error?.stack);
    
    if (error.name === 'ZodError') {
      console.error('[createAlert] Zod validation error details:', JSON.stringify(error.errors, null, 2));
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }
    
    console.error('[createAlert] Non-Zod error, calling next(error)...');
    console.error('[createAlert] ===== END ERROR HANDLING =====');
    next(error);
  }
}

/**
 * Update alert
 * Validate with updateAlertSchema (partial); verify ownership.
 * Returns { alert } — frontend uses response.data.alert
 */
async function updateAlert(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existingAlert = await prisma.alert.findUnique({
      where: { id },
    });

    if (!existingAlert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    if (existingAlert.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this alert' });
    }

    const validatedData = updateAlertSchema.parse(req.body);

    if (existingAlert.alertType === 'price') {
      const touchesBaselineFields =
        validatedData.exchange !== undefined ||
        validatedData.market !== undefined ||
        validatedData.symbols !== undefined ||
        validatedData.targetValue !== undefined;

      if (touchesBaselineFields) {
        return res.status(400).json({
          error: 'Price alert exchange/market/symbol/target cannot be edited. Please recreate the alert.',
        });
      }
    }

    const data = {};
    if (validatedData.name !== undefined) data.name = validatedData.name;
    if (validatedData.exchange !== undefined) data.exchange = validatedData.exchange;
    if (validatedData.market !== undefined) data.market = validatedData.market;
    if (validatedData.alertType !== undefined) data.alertType = validatedData.alertType;
    if (validatedData.description !== undefined) data.description = validatedData.description;
    if (validatedData.isActive !== undefined) data.isActive = validatedData.isActive;
    if (validatedData.condition !== undefined) data.condition = validatedData.condition;
    if (validatedData.targetValue !== undefined) data.targetValue = validatedData.targetValue;
    if (validatedData.coinId !== undefined) data.coinId = validatedData.coinId;
    if (validatedData.coinSymbol !== undefined) data.coinSymbol = validatedData.coinSymbol;

    if (validatedData.symbols !== undefined) {
      data.symbols = Array.isArray(validatedData.symbols)
        ? JSON.stringify(validatedData.symbols)
        : validatedData.symbols;
    }
    if (validatedData.conditions !== undefined) {
      data.conditions =
        typeof validatedData.conditions === 'string'
          ? validatedData.conditions
          : JSON.stringify(validatedData.conditions);
    }
    if (validatedData.notificationOptions !== undefined) {
      data.notificationOptions =
        typeof validatedData.notificationOptions === 'string'
          ? validatedData.notificationOptions
          : JSON.stringify(validatedData.notificationOptions);
    }

    const updatedAlert = await prisma.alert.update({
      where: { id },
      data,
    });

    res.json({ alert: updatedAlert });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }
    next(error);
  }
}

/**
 * Toggle alert isActive (for "Mode" toggle in table)
 * Verify ownership; return { alert } — frontend uses response.data.alert
 */
async function toggleAlert(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existingAlert = await prisma.alert.findUnique({
      where: { id },
    });

    if (!existingAlert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    if (existingAlert.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this alert' });
    }

    const updatedAlert = await prisma.alert.update({
      where: { id },
      data: { isActive: !existingAlert.isActive },
    });

    res.json({ alert: updatedAlert });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete alert
 * Verify ownership, delete alert
 */
async function deleteAlert(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const existingAlert = await prisma.alert.findUnique({
      where: { id },
    });

    if (!existingAlert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    if (existingAlert.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this alert' });
    }

    // Delete alert
    await prisma.alert.delete({
      where: { id },
    });

    // Clear initial price from memory if it was a pct_change alert
    if (existingAlert.condition === 'pct_change') {
      clearInitialPrice(id);
    }

    res.json({ message: 'Alert deleted successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * Get triggered alerts history
 * Get all triggered alerts for user
 */
async function getHistory(req, res, next) {
  try {
    const userId = req.user.id;

    const alerts = await prisma.alert.findMany({
      where: {
        userId,
        triggered: true,
      },
      orderBy: { triggeredAt: 'desc' },
    });

    res.json({ alerts });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAlerts,
  createAlert,
  updateAlert,
  toggleAlert,
  deleteAlert,
  getHistory,
  getEngineStatus: (req, res) => res.json(getEngineStatus()),
  checkAlertHistorically,
};
