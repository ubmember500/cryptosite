const { createPriceAlertProcessor } = require('./src/services/priceAlertEngine');
const { fetchExchangePriceSnapshot } = require('./src/services/priceSourceResolver');

function normalizeMode(argv) {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  return (modeArg ? modeArg.split('=')[1] : 'regression').toLowerCase();
}

function createResultTracker() {
  return { passed: 0, failed: 0 };
}

function assertScenario(tracker, id, condition, details) {
  if (!condition) {
    tracker.failed += 1;
    console.error(`[FAIL] ${id}`, details || '');
    return;
  }
  tracker.passed += 1;
  console.log(`[PASS] ${id}`, details || '');
}

function createMemoryPrisma() {
  const deleted = [];
  return {
    deleted,
    client: {
      alert: {
        delete: async ({ where }) => {
          deleted.push(where.id);
        },
      },
    },
  };
}

async function runRegressionSuite() {
  const tracker = createResultTracker();

  {
    const memoryDb = createMemoryPrisma();
    const triggered = [];
    const processPriceAlerts = createPriceAlertProcessor({
      prismaClient: memoryDb.client,
      priceResolver: async () => ({
        ok: false,
        status: 'unresolved',
        reasonCode: 'SYMBOL_UNRESOLVED',
        source: 'mock_unresolved',
        price: null,
        symbol: 'UNKNOWN',
      }),
    });

    await processPriceAlerts([
      {
        id: 'REG-UNRESOLVED-1',
        exchange: 'binance',
        market: 'futures',
        symbols: JSON.stringify(['UNKNOWN']),
        targetValue: 100,
        initialPrice: 99,
        condition: 'above',
      },
    ], {
      logger: console,
      onTriggered: async (_alert, payload) => triggered.push(payload),
    });

    assertScenario(
      tracker,
      'SIM-01 unresolved symbol skips trigger/delete',
      triggered.length === 0 && memoryDb.deleted.length === 0,
      { triggeredCount: triggered.length, deletedCount: memoryDb.deleted.length }
    );
  }

  {
    const memoryDb = createMemoryPrisma();
    const triggered = [];
    let callCount = 0;
    const processPriceAlerts = createPriceAlertProcessor({
      prismaClient: memoryDb.client,
      priceResolver: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: false,
            status: 'unresolved',
            reasonCode: 'UPSTREAM_PRICE_UNAVAILABLE',
            source: 'mock_exchange_map_unavailable',
            price: null,
            symbol: 'BTCUSDT',
          };
        }
        return {
          ok: true,
          status: 'resolved',
          source: 'mock_exchange_map',
          price: 101,
          symbol: 'BTCUSDT',
        };
      },
    });

    const alert = {
      id: 'REG-OUTAGE-1',
      exchange: 'bybit',
      market: 'futures',
      symbols: JSON.stringify(['BTCUSDT']),
      targetValue: 100,
      initialPrice: 99,
      condition: 'above',
      name: 'temporary outage simulation',
    };

    await processPriceAlerts([alert], {
      logger: console,
      onTriggered: async (_alert, payload) => triggered.push(payload),
    });

    await processPriceAlerts([alert], {
      logger: console,
      onTriggered: async (_alert, payload) => triggered.push(payload),
    });

    assertScenario(
      tracker,
      'SIM-02 temporary outage recovers and triggers once',
      callCount === 2 && triggered.length === 1 && memoryDb.deleted.length === 1,
      { resolverCalls: callCount, triggeredCount: triggered.length, deletedCount: memoryDb.deleted.length }
    );
  }

  {
    const memoryDb = createMemoryPrisma();
    const triggered = [];
    const processPriceAlerts = createPriceAlertProcessor({
      prismaClient: memoryDb.client,
      priceResolver: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 'resolved',
          source: 'mock_exchange_map',
          price: 90,
          symbol: 'ETHUSDT',
        };
      },
    });

    const alert = {
      id: 'REG-DUP-1',
      exchange: 'binance',
      market: 'spot',
      symbols: JSON.stringify(['ETHUSDT']),
      targetValue: 95,
      initialPrice: 100,
      condition: 'below',
      name: 'duplicate processing simulation',
    };

    await Promise.all([
      processPriceAlerts([alert], {
        logger: console,
        onTriggered: async (_alert, payload) => triggered.push(payload),
      }),
      processPriceAlerts([alert], {
        logger: console,
        onTriggered: async (_alert, payload) => triggered.push(payload),
      }),
    ]);

    assertScenario(
      tracker,
      'SIM-03 duplicate processing only triggers/deletes once',
      triggered.length === 1 && memoryDb.deleted.length === 1,
      { triggeredCount: triggered.length, deletedCount: memoryDb.deleted.length }
    );
  }

  {
    const memoryDb = createMemoryPrisma();
    const triggered = [];
    const tickPrices = [99.5, 99.9, 100.0, 100.2];
    let tickIndex = 0;

    const processPriceAlerts = createPriceAlertProcessor({
      prismaClient: memoryDb.client,
      priceResolver: async () => {
        const price = tickPrices[Math.min(tickIndex, tickPrices.length - 1)];
        tickIndex += 1;
        return {
          ok: true,
          status: 'resolved',
          source: 'mock_tick_stream',
          price,
          symbol: 'SOLUSDT',
        };
      },
    });

    const alert = {
      id: 'REG-LATENCY-1',
      exchange: 'binance',
      market: 'futures',
      symbols: JSON.stringify(['SOLUSDT']),
      targetValue: 100,
      initialPrice: 99,
      condition: 'above',
      name: 'instant latency simulation',
    };

    await processPriceAlerts([alert], {
      logger: console,
      onTriggered: async (_alert, payload) => triggered.push(payload),
    });
    await processPriceAlerts([alert], {
      logger: console,
      onTriggered: async (_alert, payload) => triggered.push(payload),
    });
    await processPriceAlerts([alert], {
      logger: console,
      onTriggered: async (_alert, payload) => triggered.push(payload),
    });

    assertScenario(
      tracker,
      'SIM-04 instant means trigger on first qualifying tick',
      triggered.length === 1 && Number(triggered[0]?.currentPrice) === 100,
      {
        observedTicks: tickIndex,
        triggerPrice: triggered[0]?.currentPrice,
        deletedCount: memoryDb.deleted.length,
      }
    );
  }

  console.log(`[test-price-alert-live-sim] regression summary passed=${tracker.passed} failed=${tracker.failed}`);
  if (tracker.failed > 0) {
    throw new Error('Regression simulation suite failed');
  }
}

async function runLiveProbe() {
  const exchange = (process.argv[2] || 'binance').toLowerCase();
  const market = (process.argv[3] || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const symbol = (process.argv[4] || 'BTCUSDT').toUpperCase();

  console.log('[test-price-alert-live-sim] bootstrap', { mode: 'live', exchange, market, symbol });

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
}

async function run() {
  const mode = normalizeMode(process.argv.slice(2));
  if (mode === 'live') {
    await runLiveProbe();
    console.log('[test-price-alert-live-sim] PASS live');
    return;
  }

  await runRegressionSuite();
  console.log('[test-price-alert-live-sim] PASS regression');
}

run().catch((error) => {
  console.error('[test-price-alert-live-sim] FAIL', error);
  process.exitCode = 1;
});
