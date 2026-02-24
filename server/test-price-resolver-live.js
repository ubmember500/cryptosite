const { fetchExchangePriceSnapshot } = require('./src/services/priceSourceResolver');
const { buildCandidates } = require('./src/services/priceSourceResolver');

function normalizeMode(argv) {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  return modeArg ? modeArg.split('=')[1].toLowerCase() : 'live';
}

function createTracker() {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const argv = process.argv.slice(2);
  const mode = normalizeMode(argv);

  if (mode === 'regression') {
    const tracker = createTracker();

    const bybitFromLower = buildCandidates('bybit', 'btcusdt', 'futures');
    assertScenario(
      tracker,
      'RES-01 symbol variant lowercase normalizes',
      Array.isArray(bybitFromLower) && bybitFromLower.includes('BTCUSDT'),
      { candidates: bybitFromLower }
    );

    const withSuffix = buildCandidates('bybit', 'BTCUSDT.P', 'futures');
    assertScenario(
      tracker,
      'RES-02 symbol variant with perpetual suffix normalizes',
      Array.isArray(withSuffix) && withSuffix.includes('BTCUSDT'),
      { candidates: withSuffix }
    );

    const baseOnly = buildCandidates('binance', 'ETH', 'spot');
    assertScenario(
      tracker,
      'RES-03 base symbol expands quote variants',
      Array.isArray(baseOnly) && baseOnly.includes('ETHUSDT') && baseOnly.includes('ETHUSD'),
      { candidates: baseOnly }
    );

    const unsupportedExchange = await fetchExchangePriceSnapshot({
      exchange: 'not-a-real-exchange',
      market: 'futures',
      symbol: 'BTCUSDT',
      strict: true,
      logger: console,
    });
    assertScenario(
      tracker,
      'RES-04 unsupported exchange returns unresolved',
      unsupportedExchange.ok === false && unsupportedExchange.reasonCode === 'UNSUPPORTED_EXCHANGE',
      unsupportedExchange
    );

    const invalidSymbol = await fetchExchangePriceSnapshot({
      exchange: 'binance',
      market: 'futures',
      symbol: '   ',
      strict: true,
      logger: console,
    });
    assertScenario(
      tracker,
      'RES-05 invalid symbol returns unresolved',
      invalidSymbol.ok === false && invalidSymbol.reasonCode === 'INVALID_SYMBOL',
      invalidSymbol
    );

    console.log(`[test-price-resolver-live] regression summary passed=${tracker.passed} failed=${tracker.failed}`);
    if (tracker.failed > 0) {
      throw new Error('Resolver regression scenarios failed');
    }
    return;
  }

  const exchange = (argv[0] || 'binance').toLowerCase();
  const market = (argv[1] || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const symbol = (argv[2] || 'BTCUSDT').toUpperCase();
  const loops = Number(argv[3] || 8);
  const delayMs = Number(argv[4] || 1000);

  console.log('[test-price-resolver-live] start', { exchange, market, symbol, loops, delayMs });

  let previous = null;
  for (let index = 1; index <= loops; index += 1) {
    const snapshot = await fetchExchangePriceSnapshot({
      exchange,
      market,
      symbol,
      strict: false,
      logger: console,
    });

    const current = Number(snapshot?.price);
    const delta = Number.isFinite(previous) && Number.isFinite(current) ? current - previous : null;

    console.log(`[${index}/${loops}]`, {
      ok: snapshot.ok,
      source: snapshot.source,
      resolvedSymbol: snapshot.symbol,
      price: Number.isFinite(current) ? current : null,
      deltaFromPrev: delta,
      candidates: snapshot.candidates?.slice(0, 5),
      error: snapshot.error || null,
    });

    previous = Number.isFinite(current) ? current : previous;
    if (index < loops) await sleep(delayMs);
  }

  console.log('[test-price-resolver-live] done');
}

run().catch((error) => {
  console.error('[test-price-resolver-live] FAIL', error);
  process.exitCode = 1;
});
