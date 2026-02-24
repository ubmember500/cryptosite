const { createPriceAlertProcessor, __test__ } = require('./src/services/priceAlertEngine');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  console.log('[test-price-alert-v2] starting');

  assert(__test__.shouldTriggerAtCurrentPrice(100, 90, 'below') === false, 'below should not trigger above target');
  assert(__test__.shouldTriggerAtCurrentPrice(89, 90, 'below') === true, 'below should trigger at/below target');
  assert(__test__.shouldTriggerAtCurrentPrice(101, 100, 'above') === true, 'above should trigger at/above target');
  assert(__test__.resolveCondition({ initialPrice: 110 }, 100) === 'below', 'condition derived below');
  assert(__test__.resolveCondition({ initialPrice: 90 }, 100) === 'above', 'condition derived above');

  const deletedIds = [];
  const triggeredPayloads = [];

  const prismaClient = {
    alert: {
      delete: async ({ where }) => {
        deletedIds.push(where.id);
      },
    },
  };

  const priceBySymbol = {
    ESPUSDT: 0.1647,
    BTCUSDT: 100.5,
  };

  const priceResolver = async ({ symbol }) => {
    const key = String(symbol || '').toUpperCase();
    const price = priceBySymbol[key];
    if (!Number.isFinite(price)) {
      return { ok: false, price: null, symbol: key, source: 'mock_missing' };
    }
    return { ok: true, price, symbol: key, source: 'mock_exchange' };
  };

  const processPriceAlerts = createPriceAlertProcessor({ prismaClient, priceResolver });

  const alerts = [
    {
      id: 'a1',
      name: 'ESP below',
      exchange: 'binance',
      market: 'futures',
      symbols: JSON.stringify(['ESPUSDT']),
      targetValue: 0.165,
      initialPrice: 0.168,
      condition: 'below',
    },
    {
      id: 'a2',
      name: 'BTC above',
      exchange: 'binance',
      market: 'futures',
      symbols: JSON.stringify(['BTCUSDT']),
      targetValue: 101,
      initialPrice: 100,
      condition: 'above',
    },
  ];

  await processPriceAlerts(alerts, {
    logger: console,
    onDeleted: async () => {},
    onTriggered: async (_alert, payload) => {
      triggeredPayloads.push(payload);
    },
  });

  assert(deletedIds.length === 1, `expected 1 delete, got ${deletedIds.length}`);
  assert(deletedIds[0] === 'a1', `expected a1 deleted, got ${deletedIds[0]}`);
  assert(triggeredPayloads.length === 1, `expected 1 triggered payload, got ${triggeredPayloads.length}`);
  assert(triggeredPayloads[0].id === 'a1', `expected triggered a1, got ${triggeredPayloads[0].id}`);

  console.log('[test-price-alert-v2] PASS');
}

run().catch((error) => {
  console.error('[test-price-alert-v2] FAIL', error);
  process.exitCode = 1;
});
