/**
 * Test script to verify WebSocket connections for each exchange
 * Run with: node test-exchange-ws.js <exchange> <symbol> <interval>
 * Example: node test-exchange-ws.js binance BTCUSDT 1m
 */

const BinanceWsAdapter = require('./src/services/exchanges/binanceWs');
const BybitWsAdapter = require('./src/services/exchanges/bybitWs');
const OkxWsAdapter = require('./src/services/exchanges/okxWs');
const GateWsAdapter = require('./src/services/exchanges/gateWs');
const BitgetWsAdapter = require('./src/services/exchanges/bitgetWs');
const MexcWsAdapter = require('./src/services/exchanges/mexcWs');

const exchange = process.argv[2] || 'binance';
const symbol = process.argv[3] || 'BTCUSDT';
const interval = process.argv[4] || '1m';
const exchangeType = 'futures';

console.log(`\n=== Testing ${exchange.toUpperCase()} WebSocket ===`);
console.log(`Symbol: ${symbol}`);
console.log(`Interval: ${interval}`);
console.log(`Exchange Type: ${exchangeType}\n`);

// Callback for kline updates
const onKlineUpdate = (symbol, interval, exchangeType, klineData) => {
  console.log(`[UPDATE] ${symbol} ${interval}:`, {
    time: new Date(klineData.time * 1000).toISOString(),
    open: klineData.open,
    high: klineData.high,
    low: klineData.low,
    close: klineData.close,
    volume: klineData.volume,
    isClosed: klineData.isClosed,
  });
};

// Create adapter based on exchange
let adapter;
switch (exchange.toLowerCase()) {
  case 'binance':
    adapter = new BinanceWsAdapter(onKlineUpdate);
    break;
  case 'bybit':
    adapter = new BybitWsAdapter(onKlineUpdate);
    break;
  case 'okx':
    adapter = new OkxWsAdapter(onKlineUpdate);
    break;
  case 'gate':
    adapter = new GateWsAdapter(onKlineUpdate);
    break;
  case 'bitget':
    adapter = new BitgetWsAdapter(onKlineUpdate);
    break;
  case 'mexc':
    adapter = new MexcWsAdapter(onKlineUpdate);
    break;
  default:
    console.error(`Unknown exchange: ${exchange}`);
    process.exit(1);
}

// Subscribe
console.log(`Subscribing...`);
adapter.subscribe(symbol, interval, exchangeType);

// Keep alive
console.log(`\nListening for updates... (Press Ctrl+C to stop)\n`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  adapter.close();
  process.exit(0);
});
