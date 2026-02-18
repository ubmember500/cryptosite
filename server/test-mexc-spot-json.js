/**
 * MEXC Spot WebSocket Test - Try JSON format on new API
 */

const WebSocket = require('ws');

const WS_URL = 'wss://wbs-api.mexc.com/ws';
const SYMBOL = 'BTCUSDT';
const INTERVAL = 'Min15';

console.log('=== MEXC Spot WebSocket Test (JSON) ===');
console.log(`URL: ${WS_URL}`);
console.log(`Symbol: ${SYMBOL}, Interval: ${INTERVAL}`);
console.log('Trying WITHOUT .pb suffix (JSON format)...');
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected');
  
  // Try JSON format (without .pb suffix)
  const subscribeMsg = {
    method: 'SUBSCRIPTION',
    params: [`spot@public.kline.v3.api@${SYMBOL}@${INTERVAL}`], // NO .pb
  };
  
  console.log('📤 Subscribing (JSON):', JSON.stringify(subscribeMsg, null, 2));
  ws.send(JSON.stringify(subscribeMsg));
  console.log('');
  console.log('Waiting for responses...');
  console.log('');
});

ws.on('message', (data) => {
  // Check if binary or JSON
  if (Buffer.isBuffer(data)) {
    const firstByte = data[0];
    if (firstByte === 0x7b) { // '{' character in ASCII
      // Actually JSON disguised as buffer
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 JSON message:', JSON.stringify(message, null, 2));
        console.log('');
      } catch (e) {
        console.log('📦 Binary data:', data.length, 'bytes');
      }
    } else {
      console.log('📦 Binary protobuf:', data.length, 'bytes');
    }
  } else {
    console.log('📨 Text message:', data);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`❌ Connection closed (code: ${code})`);
  process.exit(0);
});

// Keep alive for 30 seconds
setTimeout(() => {
  console.log('⏱️ Test complete (30s timeout)');
  ws.close();
}, 30000);
