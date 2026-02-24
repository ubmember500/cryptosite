const path = require('path');
const Database = require('better-sqlite3');
const { fetchExchangePriceSnapshot } = require('./src/services/priceSourceResolver');
const { __test__ } = require('./src/services/priceAlertEngine');

function parseSymbols(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    return parsed ? [parsed] : [];
  } catch {
    return [raw.trim()].filter(Boolean);
  }
}

async function run() {
  const dbPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'dev.db');

  const limit = Math.max(1, Number(process.argv[3] || 100));

  console.log('[test-active-price-alerts-diagnose] start', { dbPath, limit });

  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT id, userId, name, exchange, market, symbols, targetValue, condition, initialPrice, createdAt
       FROM Alert
       WHERE isActive = 1 AND alertType = 'price' AND triggered = 0
       ORDER BY datetime(createdAt) DESC
       LIMIT ?`
    )
    .all(limit);

  console.log(`[test-active-price-alerts-diagnose] found ${rows.length} active price alerts`);
  if (rows.length === 0) {
    console.log('[test-active-price-alerts-diagnose] nothing to diagnose');
    return;
  }

  let resolvableCount = 0;
  let wouldTriggerCount = 0;

  for (const row of rows) {
    const symbols = parseSymbols(row.symbols);
    const firstSymbol = symbols[0] || '';
    const targetValue = Number(row.targetValue);
    const condition = __test__.resolveCondition(row, targetValue);

    let snapshot;
    try {
      snapshot = await fetchExchangePriceSnapshot({
        exchange: row.exchange || 'binance',
        market: row.market || 'futures',
        symbol: firstSymbol,
        strict: false,
        logger: console,
      });
    } catch (error) {
      snapshot = {
        ok: false,
        symbol: firstSymbol,
        source: 'resolver_exception',
        error: error?.message || String(error),
        price: null,
      };
    }

    const currentPrice = Number(snapshot?.price);
    const wouldTrigger = __test__.shouldTriggerAtCurrentPrice(currentPrice, targetValue, condition);

    if (snapshot?.ok && Number.isFinite(currentPrice) && currentPrice > 0) {
      resolvableCount += 1;
    }
    if (wouldTrigger) {
      wouldTriggerCount += 1;
    }

    console.log({
      id: row.id,
      name: row.name,
      exchange: row.exchange,
      market: row.market,
      requestedSymbol: firstSymbol,
      resolvedSymbol: snapshot?.symbol || firstSymbol,
      source: snapshot?.source || 'unknown',
      initialPrice: row.initialPrice,
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
      targetValue,
      condition,
      wouldTrigger,
      snapshotError: snapshot?.error || null,
      createdAt: row.createdAt,
    });
  }

  console.log('[test-active-price-alerts-diagnose] summary', {
    totalAlerts: rows.length,
    resolvableCount,
    unresolvedCount: rows.length - resolvableCount,
    wouldTriggerCount,
    pendingCount: rows.length - wouldTriggerCount,
  });

  db.close();
  console.log('[test-active-price-alerts-diagnose] done');
}

run().catch((error) => {
  console.error('[test-active-price-alerts-diagnose] FAIL', error);
  process.exitCode = 1;
});
