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

function shouldTriggerAtCurrentPrice(currentPrice, targetValue, condition) {
  const current = Number(currentPrice);
  const target = Number(targetValue);
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return false;
  if (condition === 'below') return current <= target;
  return current >= target;
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

function createPriceAlertProcessor(deps = {}) {
  const prismaClient = deps.prismaClient || require('../utils/prisma');
  const priceResolver =
    deps.priceResolver ||
    require('./priceSourceResolver').fetchExchangePriceSnapshot;

  return async function processPriceAlerts(priceAlerts, handlers = {}) {
    const {
      onTriggered = async () => {},
      onDeleted = async () => {},
      logger = console,
    } = handlers;

    for (const alert of priceAlerts || []) {
      if (!alert?.id || inFlightAlertIds.has(alert.id)) continue;
      inFlightAlertIds.add(alert.id);

      try {
        const symbols = parseSymbols(alert.symbols);
        const firstSymbol = symbols[0];
        if (!firstSymbol) {
          logger.warn?.(`[priceAlertV2] alert=${alert.id} skipped: missing symbol`);
          continue;
        }

        const exchange = String(alert.exchange || 'binance').toLowerCase();
        const market = normalizeMarket(alert.market);
        const targetValue = Number(alert.targetValue);
        if (!Number.isFinite(targetValue) || targetValue <= 0) {
          logger.warn?.(`[priceAlertV2] alert=${alert.id} skipped: invalid target ${alert.targetValue}`);
          continue;
        }

        const snapshot = await priceResolver({
          exchange,
          market,
          symbol: firstSymbol,
          strict: false,
          logger,
        });

        const currentPrice = Number(snapshot?.price);
        if (!snapshot?.ok || !Number.isFinite(currentPrice) || currentPrice <= 0) {
          logger.warn?.(
            `[priceAlertV2] alert=${alert.id} unresolved price ` +
            `exchange=${exchange}/${market} symbol=${firstSymbol} source=${snapshot?.source || 'unknown'}`
          );
          continue;
        }

        const condition = resolveCondition(alert, targetValue);
        const triggered = shouldTriggerAtCurrentPrice(currentPrice, targetValue, condition);

        logger.log?.(
          `[priceAlertV2] alert=${alert.id} symbol=${snapshot.symbol || firstSymbol} ` +
          `target=${targetValue} current=${currentPrice} cond=${condition} source=${snapshot.source} ` +
          `triggered=${triggered}`
        );

        if (!triggered) continue;

        // Use ONE timestamp for both the DB write and the payload so the
        // deduplication key (alertId:triggeredAt ISO) matches when pendingNotifications
        // returns the same DB-stored value on the next fetchAlerts poll.
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
          coinSymbol: deriveCoinSymbol(alert, snapshot.symbol || firstSymbol),
          symbol: snapshot.symbol || firstSymbol,
          alertType: 'price',
          priceSource: snapshot.source,
          ...(alert.initialPrice != null && Number.isFinite(Number(alert.initialPrice))
            ? { initialPrice: Number(alert.initialPrice) }
            : {}),
        };

        // Atomic update: only succeeds if THIS process is the first to mark it triggered.
        // Using updateMany with triggered:false guard prevents double-firing when the
        // engine and the sweep both race to the same alert.
        // We intentionally keep the row in the DB (triggered=true, isActive=false) so
        // that the client can retrieve it as a pendingNotification if the socket event
        // was missed (race condition on page-load, disconnect, cold start, etc.).
        const updateResult = await prismaClient.alert.updateMany({
          where: { id: alert.id, triggered: false, isActive: true },
          data: { triggered: true, isActive: false, triggeredAt },
        });

        if (updateResult.count === 0) {
          logger.warn?.(`[priceAlertV2] alert=${alert.id} already triggered by another process, skipping`);
          continue;
        }

        await onDeleted(alert);
        await onTriggered(alert, payload);
        logger.log?.(`[priceAlertV2] TRIGGERED alert=${alert.id} (marked triggered, kept in DB for notification delivery)`);
      } catch (error) {
        logger.error?.(`[priceAlertV2] alert=${alert.id} unexpected error:`, error);
      } finally {
        inFlightAlertIds.delete(alert.id);
      }
    }
  };
}

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
