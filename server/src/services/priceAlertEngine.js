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

/**
 * TradingView-style crossing detection.
 * The alert must only fire when the price genuinely CROSSES the target level —
 * i.e. it was on the initial side and has now moved to the other side.
 *
 * We use `initialPrice` (captured at alert-creation time from the same exchange)
 * as proof that the price started on one side.  If the current price is already
 * on the SAME side as initialPrice (relative to target), we do NOT trigger,
 * even if ` current >= target`.  This prevents false triggers caused by price
 * source jitter, CoinGecko fallback, or stale cache values.
 */
function shouldTriggerAtCurrentPrice(currentPrice, targetValue, condition, initialPrice) {
  const current = Number(currentPrice);
  const target = Number(targetValue);
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return false;

  // Basic level check
  const pastTarget = condition === 'below' ? current <= target : current >= target;
  if (!pastTarget) return false;

  // Crossing guard: verify initialPrice is on the OPPOSITE side of target.
  // Without this, a momentary wrong price from cache/fallback could trigger.
  const initial = Number(initialPrice);
  if (Number.isFinite(initial) && initial > 0) {
    if (condition === 'above' && initial >= target) return false; // was already above → no crossing
    if (condition === 'below' && initial <= target) return false; // was already below → no crossing
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
        // Grace period: skip alerts younger than 10 seconds.
        // Prevents the engine from acting on a brand-new alert before the
        // exchange WS feed / REST cache has had time to settle to the same
        // price that createAlert saw.  TradingView also has a brief settle
        // window after alert creation.
        const alertAgeMs = alert.createdAt ? Date.now() - new Date(alert.createdAt).getTime() : Infinity;
        if (alertAgeMs < 10_000) continue;

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

        // Use the efficient CACHED bulk ticker with exchangeOnly:true (no CoinGecko).
        //
        // Why NOT strict:true:
        //   strict:true forces fetchCurrentPriceBySymbol (per-symbol REST) as the first
        //   attempt, which makes a separate HTTP call to Binance every 300ms PER ALERT.
        //   With 4+ alerts this can exceed Binance's IP rate limit (2400 weight/min),
        //   causing 429 errors → 15-second error cooldown → ALL alerts silently skipped.
        //   The efficient path is getLastPricesBySymbols whose 2s cache is shared across
        //   ALL alerts in the same cycle (one bulk fetch for any number of alerts).
        //
        // Why strict:false:
        //   On price-feed failure we want ok:false (skip this cycle gracefully), not throw.
        //   The historical klines sweep acts as the safety net for missed cycles.
        //
        // Why exchangeOnly:true:
        //   Prevents CoinGecko fallback when Binance API is temporarily unavailable.
        //   CoinGecko returns a global average price that differs from exchange-specific
        //   futures prices, which was the original cause of false triggers.
        const snapshot = await priceResolver({
          exchange,
          market,
          symbol: firstSymbol,
          strict: false,
          exchangeOnly: true,
          logger,
        });

        const currentPrice = Number(snapshot?.price);
        if (!snapshot?.ok || !Number.isFinite(currentPrice) || currentPrice <= 0) {
          // Distinguish permanent failures (symbol doesn't exist on exchange) from
          // transient ones (API timeout, cache miss) so they're easy to spot in logs.
          const isPermanent = snapshot?.reasonCode === 'SYMBOL_UNRESOLVED'
            || snapshot?.reasonCode === 'INVALID_SYMBOL';
          const logLevel = isPermanent ? 'error' : 'warn';
          logger[logLevel]?.(
            `[priceAlertV2] alert=${alert.id} price unresolved ` +
            `exchange=${exchange}/${market} symbol=${firstSymbol} ` +
            `reason=${snapshot?.reasonCode || 'unknown'} source=${snapshot?.source || 'unknown'}` +
            (isPermanent
              ? ' ← symbol may not exist on this exchange; alert will never fire until fixed'
              : ' (transient — will retry next cycle)')
          );
          continue;
        }

        const condition = resolveCondition(alert, targetValue);
        const initialPrice = alert?.initialPrice != null ? Number(alert.initialPrice) : null;
        const triggered = shouldTriggerAtCurrentPrice(currentPrice, targetValue, condition, initialPrice);

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
