/**
 * MEXC Spot WebSocket Test
 * Tests raw WebSocket connection to verify data structure
 */

const WebSocket = require('ws');

const WS_URL = 'wss://wbs-api.mexc.com/ws'; // NEW URL (old one deprecated Aug 2025)
const SYMBOL = 'BTCUSDT'; // Spot uses no underscore
const INTERVAL = 'Min15'; // MEXC spot uses Min1, Min5, Min15, etc.

console.log('=== MEXC Spot WebSocket Test ===');
console.log(`URL: ${WS_URL}`);
console.log(`Symbol: ${SYMBOL}, Interval: ${INTERVAL}`);
console.log('⚠️  NOTE: New API uses Protobuf format - binary data expected');
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected');
  
  // MEXC spot subscription format (new API with .pb suffix for protobuf)
  const subscribeMsg = {
    method: 'SUBSCRIPTION',
    params: [`spot@public.kline.v3.api.pb@${SYMBOL}@${INTERVAL}`],
  };
  
  console.log('📤 Subscribing to:', JSON.stringify(subscribeMsg, null, 2));
  ws.send(JSON.stringify(subscribeMsg));
  console.log('');
  console.log('Waiting for responses...');
  console.log('');
});

ws.on('message', (data) => {
  // Check if data is binary (protobuf) or text (JSON)
  if (Buffer.isBuffer(data)) {
    console.log('📦 Received BINARY data (protobuf):', data.length, 'bytes');
    console.log('   First 50 bytes (hex):', data.slice(0, 50).toString('hex'));
    console.log('   ⚠️  Cannot parse without protobuf library');
    console.log('');
    return;
  }
  
  try {
    const message = JSON.parse(data.toString());
    
    // Handle subscription confirmation
    if (message.msg === 'SUCCESS' || message.code === 0) {
      console.log('✅ Subscription response:', message);
      console.log('');
      return;
    }
    
    // Handle error
    if (message.code && message.code !== 0) {
      console.error('❌ Subscription error:', message);
      return;
    }
    
    // Handle kline data (if still JSON format)
    if (message.publicspotkline) {
      const k = message.publicspotkline;
      console.log(`📊 Kline: O:${k.openingprice} H:${k.highestprice} L:${k.lowestprice} C:${k.closingprice} V:${k.volume}`);
      console.log('   Full data:', k);
      console.log('');
    } else {
      console.log('ℹ️ Other JSON message:', JSON.stringify(message).substring(0, 200));
    }
  } catch (error) {
    console.error('❌ Error parsing message:', error.message);
    console.log('Raw data (text):', data.toString().substring(0, 200));
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`❌ Connection closed (code: ${code})`);
  process.exit(0);
});

// Keep alive for 60 seconds
setTimeout(() => {
  console.log('⏱️ Test complete (60s timeout)');
  ws.close();
}, 60000);
