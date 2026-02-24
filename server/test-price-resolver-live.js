const { fetchExchangePriceSnapshot } = require('./src/services/priceSourceResolver');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const exchange = (process.argv[2] || 'binance').toLowerCase();
  const market = (process.argv[3] || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const symbol = (process.argv[4] || 'BTCUSDT').toUpperCase();
  const loops = Number(process.argv[5] || 8);
  const delayMs = Number(process.argv[6] || 1000);

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
