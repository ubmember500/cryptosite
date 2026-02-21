const prisma = require('../utils/prisma');
const { alertSchema, createAlertSchema, updateAlertSchema } = require('../utils/validators');
const priceService = require('../services/priceService');
const binanceService = require('../services/binanceService');
const bybitService = require('../services/bybitService');
const okxService = require('../services/okxService');
const gateService = require('../services/gateService');
const mexcService = require('../services/mexcService');
const bitgetService = require('../services/bitgetService');
const exchangeFallbackPriceService = require('../services/exchangeFallbackPriceService');
const { setInitialPrice, clearInitialPrice } = require('../services/alertEngine');

/** Derive coinSymbol and coinId from first symbol (e.g. BTCUSDT -> BTC, btc) */
function deriveLegacyFromFirstSymbol(symbols) {
  const arr = Array.isArray(symbols) ? symbols : symbols ? [symbols] : [];
  const first = arr[0];
  if (!first || typeof first !== 'string') return { coinSymbol: '', coinId: '' };
  const base = first.replace(/USDT$/i, '').replace(/USD$/i, '') || first;
  return { coinSymbol: base, coinId: base.toLowerCase() };
}

async function fetchCrossExchangeFallbackPrice({ sourceExchange, symbol, market }) {
  const exchangeType = market === 'spot' ? 'spot' : 'futures';
  const source = String(sourceExchange || '').toLowerCase();

  const providers = [
    {
      id: 'okx',
      normalize: okxService.normalizeSymbol,
      fetch: (normalized) => okxService.getLastPricesBySymbols([normalized], exchangeType),
    },
    {
      id: 'gate',
      normalize: gateService.normalizeSymbol,
      fetch: (normalized) => gateService.getLastPricesBySymbols([normalized], exchangeType),
    },
    {
      id: 'mexc',
      normalize: mexcService.normalizeSymbol,
      fetch: (normalized) => mexcService.getLastPricesBySymbols([normalized], exchangeType),
    },
    {
      id: 'bitget',
      normalize: bitgetService.normalizeSymbol,
      fetch: (normalized) => bitgetService.getLastPricesBySymbols([normalized], exchangeType),
    },
    {
      id: 'bybit',
      normalize: bybitService.normalizeSymbol,
      fetch: (normalized) => bybitService.getLastPricesBySymbols([normalized], exchangeType, { strict: false }),
    },
    {
      id: 'binance',
      normalize: binanceService.normalizeSymbol,
      fetch: (normalized) => binanceService.getLastPricesBySymbols([normalized], exchangeType, { strict: false }),
    },
  ].filter((provider) => provider.id !== source);

  for (const provider of providers) {
    try {
      const normalizedSymbol = provider.normalize(symbol);
      if (!normalizedSymbol) continue;

      const prices = await provider.fetch(normalizedSymbol);
      const price = prices?.[normalizedSymbol] ?? prices?.[symbol];
      if (price != null && Number.isFinite(price) && price > 0) {
        return {
          price,
          provider: provider.id,
          normalizedSymbol,
        };
      }
    } catch (error) {
      console.warn('[createAlert] Cross-exchange fallback provider failed:', {
        sourceExchange: source,
        provider: provider.id,
        symbol,
        market,
        error: error.message,
      });
    }
  }

  return null;
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

    res.json({ alerts });
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
    // Normalize payload: frontend may send type → alertType, priceCondition → condition, exchanges → exchange
    const body = { ...req.body };
    if (body.type != null && body.alertType == null) body.alertType = body.type;
    if (body.priceCondition != null && body.condition == null) body.condition = body.priceCondition;
    if (Array.isArray(body.exchanges) && body.exchanges.length > 0 && body.exchange == null) body.exchange = body.exchanges[0];

    // Coerce to shapes expected by simplified createAlertSchema (avoids Zod v4 union/transform _zod errors)
    if (body.symbols != null) {
      body.symbols = Array.isArray(body.symbols) ? body.symbols : (typeof body.symbols === 'string' ? (() => { try { const p = JSON.parse(body.symbols); return Array.isArray(p) ? p : [body.symbols]; } catch { return [body.symbols]; } })() : []);
    }
    if (body.conditions != null && body.conditions !== '') {
      body.conditions = typeof body.conditions === 'string' ? body.conditions : JSON.stringify(body.conditions);
    }
    if (body.notificationOptions != null) {
      body.notificationOptions = typeof body.notificationOptions === 'string' ? body.notificationOptions : JSON.stringify(body.notificationOptions);
    }
    if (body.targetValue !== undefined && body.targetValue !== null && body.targetValue !== '') {
      const n = typeof body.targetValue === 'number' ? body.targetValue : parseFloat(body.targetValue, 10);
      body.targetValue = Number.isFinite(n) ? n : undefined;
    } else {
      body.targetValue = undefined;
    }
    if (body.currentPrice !== undefined && body.currentPrice !== null && body.currentPrice !== '') {
      const n = typeof body.currentPrice === 'number' ? body.currentPrice : parseFloat(body.currentPrice, 10);
      body.currentPrice = Number.isFinite(n) ? n : undefined;
    } else {
      body.currentPrice = undefined;
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

    const symbolsStr =
      validatedData.symbols != null
        ? JSON.stringify(Array.isArray(validatedData.symbols) ? validatedData.symbols : [validatedData.symbols])
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

    // B1: For price alerts with symbols, fetch exchange price at creation and store as initialPrice
    // CRITICAL: initialPrice is REQUIRED for price alerts to determine condition and verify cross
    let initialPrice = null;
    const clientProvidedInitialPrice = Number(validatedData.currentPrice);
    const exchange = (validatedData.exchange || 'binance').toLowerCase();
    if (validatedData.alertType === 'price' && validatedData.symbols != null) {
      const syms = Array.isArray(validatedData.symbols) ? validatedData.symbols : [validatedData.symbols];
      const firstSymbolRaw = syms[0];
      const market = (validatedData.market || 'futures').toLowerCase();
      const exchangeType = market === 'spot' ? 'spot' : 'futures';

      if (firstSymbolRaw && typeof firstSymbolRaw === 'string') {
        const normalize =
          exchange === 'bybit'
            ? bybitService.normalizeSymbol
            : exchange === 'okx'
              ? okxService.normalizeSymbol
              : exchange === 'gate'
                ? gateService.normalizeSymbol
                : exchange === 'mexc'
                  ? mexcService.normalizeSymbol
                  : exchange === 'bitget'
                    ? bitgetService.normalizeSymbol
                    : binanceService.normalizeSymbol;
        const normalizedSymbol = normalize(firstSymbolRaw);
        console.log('[createAlert] Fetching initial price for price alert:', {
          exchange,
          originalSymbol: firstSymbolRaw,
          normalizedSymbol,
          market,
        });

        if (!normalizedSymbol) {
          return res.status(400).json({
            error: 'Invalid symbol format. Cannot fetch current price.',
            details: { symbol: firstSymbolRaw },
          });
        }

        try {
          const getPrices =
            exchange === 'bybit'
              ? () => bybitService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true })
              : exchange === 'okx'
                ? () => okxService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true })
                : exchange === 'gate'
                  ? () => gateService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true })
                  : exchange === 'mexc'
                    ? () => mexcService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true })
                    : exchange === 'bitget'
                      ? () => bitgetService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true })
                      : () => binanceService.getLastPricesBySymbols([normalizedSymbol], exchangeType, { strict: true });
          const prices = await getPrices();

          const p = prices[normalizedSymbol];
          if (p != null && Number.isFinite(p) && p > 0) {
            initialPrice = p;
            console.log('[createAlert] Initial price fetched:', {
              exchange,
              originalSymbol: firstSymbolRaw,
              normalizedSymbol,
              initialPrice,
            });
          } else {
            return res.status(400).json({
              error: 'Could not fetch current price for symbol. Symbol may not exist or may not be trading.',
              details: {
                symbol: firstSymbolRaw,
                normalizedSymbol,
                availableSymbolsCount: Object.keys(prices).length,
              },
            });
          }
        } catch (err) {
          console.error(`[createAlert] ${exchange} API error when fetching initial price:`, {
            error: err.message,
            code: err.code,
            status: err.statusCode || err.response?.status,
            symbol: normalizedSymbol,
            market,
          });

          const isUpstreamUnavailable =
            err?.code === 'UPSTREAM_PRICE_UNAVAILABLE' ||
            ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNABORTED'].includes(String(err?.code || '').toUpperCase()) ||
            [403, 429, 451, 502, 503, 504].includes(err?.statusCode || err?.response?.status);

          if (isUpstreamUnavailable) {
            if (exchange === 'binance' || exchange === 'bybit') {
              if (Number.isFinite(clientProvidedInitialPrice) && clientProvidedInitialPrice > 0) {
                initialPrice = clientProvidedInitialPrice;
                console.log('[createAlert] Initial price resolved via client snapshot fallback:', {
                  exchange,
                  symbol: normalizedSymbol,
                  market,
                  initialPrice,
                });
              }

              try {
                const fallbackPrice =
                  initialPrice != null && Number.isFinite(initialPrice) && initialPrice > 0
                    ? null
                    : await exchangeFallbackPriceService.fetchPriceViaCcxt({
                        exchange,
                        symbol: normalizedSymbol,
                        market,
                      });

                if (fallbackPrice != null && Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
                  initialPrice = fallbackPrice;
                  console.log('[createAlert] Initial price resolved via fallback provider:', {
                    exchange,
                    symbol: normalizedSymbol,
                    market,
                    initialPrice,
                  });
                }
              } catch (fallbackErr) {
                console.error('[createAlert] Fallback provider failed:', {
                  exchange,
                  symbol: normalizedSymbol,
                  market,
                  error: fallbackErr.message,
                });
              }
            }

            if (initialPrice == null || !Number.isFinite(initialPrice) || initialPrice <= 0) {
              const crossExchangeFallback = await fetchCrossExchangeFallbackPrice({
                sourceExchange: exchange,
                symbol: normalizedSymbol,
                market,
              });

              if (crossExchangeFallback?.price != null && Number.isFinite(crossExchangeFallback.price) && crossExchangeFallback.price > 0) {
                initialPrice = crossExchangeFallback.price;
                console.log('[createAlert] Initial price resolved via cross-exchange fallback:', {
                  requestedExchange: exchange,
                  providerExchange: crossExchangeFallback.provider,
                  symbol: normalizedSymbol,
                  providerSymbol: crossExchangeFallback.normalizedSymbol,
                  market,
                  initialPrice,
                });
              }
            }

            if (initialPrice != null && Number.isFinite(initialPrice) && initialPrice > 0) {
              // Continue create flow using fallback snapshot price.
            } else {
              return res.status(503).json({
                error: `Failed to fetch current price from ${exchange}. Exchange upstream is temporarily unavailable from server environment. Please try again later or switch exchange.`,
                details: {
                  exchange,
                  symbol: firstSymbolRaw,
                  normalizedSymbol,
                  market,
                  error: err.message,
                },
              });
            }
          } else {
            return res.status(503).json({
              error: 'Failed to fetch current price from exchange. Please try again later.',
              details: {
                exchange,
                symbol: firstSymbolRaw,
                normalizedSymbol,
                market,
                error: err.message,
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
      if (Math.abs(delta) <= PRICE_TOLERANCE) {
        return res.status(400).json({
          error: 'Target price equals current price. Alert cannot be created.',
          details: {
            currentPrice: initialPrice,
            targetPrice: targetValue,
          },
        });
      }

      condition = delta > 0 ? 'below' : 'above';
      console.log('[createAlert] Direction resolved from snapshot:', {
        initialPrice,
        targetValue,
        condition,
      });
    }

    const createData = {
      userId,
      name: validatedData.name,
      exchange: validatedData.exchange ?? 'binance',
      market: validatedData.market ?? 'futures',
      alertType: validatedData.alertType,
      description: validatedData.description ?? null,
      symbols: symbolsStr,
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

    if (validatedData.alertType === 'price' && condition === 'pct_change') {
      try {
        const coinData = await priceService.fetchCoinPrice(coinId);
        setInitialPrice(alert.id, coinData.currentPrice);
      } catch (error) {
        console.error(`Failed to fetch initial price for alert ${alert.id}:`, error.message);
      }
    }

    console.log('[createAlert] ===== SUCCESS =====');
    res.status(201).json({ alert });
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
};
