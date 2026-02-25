const { createPriceAlertProcessor, __test__ } = require('./src/services/priceAlertEngine');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  console.log('[test-price-alert-v2] starting');

  // --- Basic level checks (no initialPrice → crossing guard skipped) ---
  assert(__test__.shouldTriggerAtCurrentPrice(100, 90, 'below') === false, 'below should not trigger above target');
  assert(__test__.shouldTriggerAtCurrentPrice(89, 90, 'below') === true, 'below should trigger at/below target');
  assert(__test__.shouldTriggerAtCurrentPrice(101, 100, 'above') === true, 'above should trigger at/above target');

  // --- Crossing guard: with initialPrice confirming the crossing ---
  // alert: initial=110, target=100, condition='below' → initial ABOVE target → crossing valid
  assert(__test__.shouldTriggerAtCurrentPrice(99, 100, 'below', 110) === true, 'below crossing: initial above target, current below → TRIGGER');
  // alert: initial=90, target=100, condition='above' → initial BELOW target → crossing valid
  assert(__test__.shouldTriggerAtCurrentPrice(101, 100, 'above', 90) === true, 'above crossing: initial below target, current above → TRIGGER');

  // --- Crossing guard: initial already on wrong side → NO TRIGGER (prevents false positives) ---
  // initial=90 (already below target), condition='below' → no crossing possible
  assert(__test__.shouldTriggerAtCurrentPrice(89, 90, 'below', 85) === false, 'below: initial already below target → NO TRIGGER');
  // initial=110 (already above target), condition='above' → no crossing possible
  assert(__test__.shouldTriggerAtCurrentPrice(101, 100, 'above', 105) === false, 'above: initial already above target → NO TRIGGER');

  // --- Edge: initialPrice exactly at target → no crossing (already there) ---
  assert(__test__.shouldTriggerAtCurrentPrice(101, 100, 'above', 100) === false, 'above: initial AT target → no crossing');
  assert(__test__.shouldTriggerAtCurrentPrice(99, 100, 'below', 100) === false, 'below: initial AT target → no crossing');

  // --- Condition derivation ---
  assert(__test__.resolveCondition({ initialPrice: 110 }, 100) === 'below', 'condition derived below');
  assert(__test__.resolveCondition({ initialPrice: 90 }, 100) === 'above', 'condition derived above');

  console.log('[test-price-alert-v2] ✓ All unit tests passed');

  const markedTriggeredIds = [];
  const triggeredPayloads = [];

  const prismaClient = {
    alert: {
      updateMany: async ({ where }) => {
        if (where?.id) {
          markedTriggeredIds.push(where.id);
          return { count: 1 };
        }
        return { count: 0 };
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

  assert(markedTriggeredIds.length === 1, `expected 1 trigger mark, got ${markedTriggeredIds.length}`);
  assert(markedTriggeredIds[0] === 'a1', `expected a1 trigger mark, got ${markedTriggeredIds[0]}`);
  assert(triggeredPayloads.length === 1, `expected 1 triggered payload, got ${triggeredPayloads.length}`);
  assert(triggeredPayloads[0].id === 'a1', `expected triggered a1, got ${triggeredPayloads[0].id}`);

  console.log('[test-price-alert-v2] PASS');
}

run().catch((error) => {
  console.error('[test-price-alert-v2] FAIL', error);
  process.exitCode = 1;
});
