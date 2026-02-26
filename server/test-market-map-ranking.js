/**
 * Diagnostic test: Market Map Ranking
 *
 * Tests that the /market-map endpoint returns tokens ranked by REAL 5m NATR
 * (not just by volume, which would always put BTC/ETH/SOL at top).
 *
 * Usage:
 *   node server/test-market-map-ranking.js              # test local server (localhost:5000)
 *   node server/test-market-map-ranking.js production    # test production (Render)
 *   node server/test-market-map-ranking.js direct        # test service directly (no server)
 */

const TARGET = process.argv[2] || 'local';

const PROD_URL = 'https://cryptosite-rud8.onrender.com/api/market';
const LOCAL_URL = 'http://localhost:5000/api/market';

async function testViaAPI(baseUrl, exchange = 'binance') {
  console.log(`\n=== Testing ${exchange} market-map via API: ${baseUrl}/${exchange}/market-map ===\n`);

  const url = `${baseUrl}/${exchange}/market-map?limit=0`;
  const startMs = Date.now();

  const response = await fetch(url);
  const elapsed = Date.now() - startMs;

  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${response.statusText}`);
    const text = await response.text();
    console.error(text.slice(0, 500));
    return false;
  }

  const data = await response.json();
  const rows = data.rows || [];

  console.log(`Response in ${elapsed}ms`);
  console.log(`Exchange: ${data.exchange}, Type: ${data.exchangeType}`);
  console.log(`Total: ${data.totalCount}, Scored: ${data.scoredCount}, WarmupRatio: ${data.warmupRatio}`);
  console.log(`Stale: ${data.isStale}, UpdatedAt: ${data.updatedAt}`);
  console.log(`Contract: ${JSON.stringify(data.contract)}`);
  if (data.lastError) console.log(`LastError: ${data.lastError}`);
  console.log('');

  if (rows.length === 0) {
    console.error('FAIL: No rows returned! API returned empty ranking.');
    return false;
  }

  // Show top 20
  console.log('Top 20 by 5m NATR:');
  console.log('─'.repeat(70));
  console.log(`${'#'.padEnd(4)} ${'Symbol'.padEnd(16)} ${'NATR 5m %'.padStart(12)} ${'Volume24h'.padStart(18)} ${'Metric'.padEnd(16)}`);
  console.log('─'.repeat(70));
  rows.slice(0, 20).forEach((row, i) => {
    console.log(
      `${String(i + 1).padEnd(4)} ${(row.symbol || '?').padEnd(16)} ${row.activityScore.toFixed(4).padStart(12)} ${Number(row.volume24h || 0).toLocaleString().padStart(18)} ${(row.activityMetric || '?').padEnd(16)}`
    );
  });
  console.log('─'.repeat(70));

  // Validate ranking
  const top3 = rows.slice(0, 3).map((r) => r.symbol);
  const volumeGiants = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const isJustVolumeSort = top3.every((sym) => volumeGiants.includes(sym));

  if (isJustVolumeSort) {
    console.log('\nWARNING: Top 3 are BTC/ETH/SOL — ranking may still be volume-based!');
  } else {
    console.log('\nOK: Top 3 are NOT the usual BTC/ETH/SOL volume leaders — NATR ranking is working.');
  }

  // Check that scores are decreasing
  let isDecreasing = true;
  for (let i = 1; i < Math.min(rows.length, 20); i++) {
    if (rows[i].activityScore > rows[i - 1].activityScore) {
      isDecreasing = false;
      console.log(`FAIL: Row ${i} (${rows[i].symbol}=${rows[i].activityScore}) > Row ${i-1} (${rows[i-1].symbol}=${rows[i-1].activityScore})`);
    }
  }
  if (isDecreasing) {
    console.log('OK: Scores are monotonically decreasing (properly sorted).');
  }

  // Check metric
  const metrics = new Set(rows.map((r) => r.activityMetric));
  console.log(`Metrics present: ${Array.from(metrics).join(', ')}`);
  if (metrics.has('natr5m_kline')) {
    console.log('OK: Using on-demand kline-based NATR (natr5m_kline).');
  } else if (metrics.has('natr5m')) {
    console.log('INFO: Using ring-buffer NATR (natr5m) — server has been running 5+ minutes.');
  } else {
    console.log('WARNING: Unexpected metric type.');
  }

  // Check score magnitudes
  const topScore = rows[0]?.activityScore || 0;
  const btcRow = rows.find((r) => r.symbol === 'BTCUSDT');
  const btcScore = btcRow?.activityScore || 0;
  const btcRank = btcRow ? rows.indexOf(btcRow) + 1 : 'not found';

  console.log(`\nTop token: ${rows[0].symbol} = ${topScore.toFixed(4)}%`);
  console.log(`BTC rank: #${btcRank}, score: ${btcScore.toFixed(4)}%`);

  if (topScore > btcScore * 1.5) {
    console.log('OK: Top token is significantly more volatile than BTC — real NATR ranking confirmed.');
  } else if (topScore > 0 && btcScore > 0) {
    console.log('INFO: Top token and BTC have similar scores — market may be calm, or ranking could be improved.');
  }

  return !isJustVolumeSort && isDecreasing;
}

async function testDirectService() {
  console.log('\n=== Testing binanceMarketMapService.getRanking() directly ===\n');

  const service = require('./src/services/binanceMarketMapService');
  const startMs = Date.now();

  const result = await service.getRanking({ limit: 0 });
  const elapsed = Date.now() - startMs;

  console.log(`Computation took ${elapsed}ms`);
  console.log(`Total: ${result.totalCount}, Scored: ${result.scoredCount}`);
  console.log(`Stale: ${result.isStale}, UpdatedAt: ${result.updatedAt}`);
  if (result.lastError) console.log(`Error: ${result.lastError}`);

  const rows = result.rows || [];
  if (rows.length === 0) {
    console.error('FAIL: No rows returned from direct service call.');
    return false;
  }

  console.log(`\nTop 20:`);
  console.log('─'.repeat(70));
  rows.slice(0, 20).forEach((row, i) => {
    console.log(
      `#${(i + 1).toString().padEnd(3)} ${(row.symbol || '?').padEnd(16)} NATR=${row.activityScore.toFixed(4).padStart(10)}%  vol=${Number(row.volume24h || 0).toLocaleString().padStart(16)}  [${row.activityMetric}]`
    );
  });
  console.log('─'.repeat(70));

  // Second call (should be cached, much faster)
  const start2 = Date.now();
  const result2 = await service.getRanking({ limit: 0 });
  const elapsed2 = Date.now() - start2;
  console.log(`\nSecond call (cached): ${elapsed2}ms, ${result2.rows.length} rows`);

  const top3 = rows.slice(0, 3).map((r) => r.symbol);
  const isVolumeSort = top3.every((sym) => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(sym));

  console.log(isVolumeSort
    ? '\nWARNING: Still showing BTC/ETH/SOL at top!'
    : '\nOK: Volatile tokens are at the top — fix is working!'
  );

  return !isVolumeSort;
}

async function main() {
  console.log('Market Map Ranking Diagnostic Test');
  console.log('==================================');
  console.log(`Mode: ${TARGET}`);
  console.log(`Time: ${new Date().toISOString()}`);

  let passed = false;
  try {
    if (TARGET === 'production' || TARGET === 'prod') {
      passed = await testViaAPI(PROD_URL, 'binance');
    } else if (TARGET === 'direct') {
      passed = await testDirectService();
    } else {
      passed = await testViaAPI(LOCAL_URL, 'binance');
    }
  } catch (error) {
    console.error('\nTest failed with error:', error.message || error);
    if (TARGET === 'local' && error.cause?.code === 'ECONNREFUSED') {
      console.log('\nHint: Is the server running? Start it with: cd server && npm start');
    }
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(passed ? 'RESULT: PASS ✓' : 'RESULT: NEEDS ATTENTION');
  console.log(`${'='.repeat(40)}`);

  // Allow process to exit (service may have started intervals)
  process.exit(passed ? 0 : 1);
}

main();
