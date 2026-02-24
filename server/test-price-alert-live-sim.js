const { createPriceAlertProcessor } = require('./src/services/priceAlertEngine');
const { fetchExchangePriceSnapshot } = require('./src/services/priceSourceResolver');

async function run() {
  const exchange = (process.argv[2] || 'binance').toLowerCase();
  const market = (process.argv[3] || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const symbol = (process.argv[4] || 'BTCUSDT').toUpperCase();

  console.log('[test-price-alert-live-sim] bootstrap', { exchange, market, symbol });

  const baseline = await fetchExchangePriceSnapshot({
    exchange,
    market,
    symbol,
    strict: false,
    logger: console,
  });

  const baselinePrice = Number(baseline?.price);
  if (!baseline?.ok || !Number.isFinite(baselinePrice) || baselinePrice <= 0) {
    throw new Error(`Failed to fetch baseline live price: ${baseline?.error || 'unknown'}`);
  }

  const target = baselinePrice * 1.01;
  const alert = {
    id: 'sim-live-1',
    userId: 'sim-user',
    name: `${symbol} test below`,
    exchange,
    market,
    symbols: JSON.stringify([symbol]),
    targetValue: target,
    initialPrice: target + Math.max(target * 0.001, 0.00000001),
    condition: 'below',
    description: 'live simulation alert',
    coinSymbol: symbol.replace(/USDT$|USD$/i, ''),
  };

  const deleted = [];
  const triggered = [];

  const prismaClient = {
    alert: {
      delete: async ({ where }) => {
        deleted.push(where.id);
      },
    },
  };

  const processPriceAlerts = createPriceAlertProcessor({
    prismaClient,
    priceResolver: fetchExchangePriceSnapshot,
  });

  await processPriceAlerts([alert], {
    logger: console,
    onDeleted: async () => {},
    onTriggered: async (_alert, payload) => {
      triggered.push(payload);
    },
  });

  console.log('[test-price-alert-live-sim] result', {
    baselineSource: baseline.source,
    baselinePrice,
    target,
    deletedCount: deleted.length,
    triggeredCount: triggered.length,
    triggerPayload: triggered[0] || null,
  });

  if (triggered.length !== 1 || deleted.length !== 1) {
    throw new Error('Expected exactly one trigger/delete in live simulation');
  }

  console.log('[test-price-alert-live-sim] PASS');
}

run().catch((error) => {
  console.error('[test-price-alert-live-sim] FAIL', error);
  process.exitCode = 1;
});
