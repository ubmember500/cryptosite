/**
 * OKX WebSocket Test
 * Tests raw WebSocket connection to verify data structure
 */

const WebSocket = require('ws');

// IMPORTANT: OKX moved candle channel to business WebSocket!
const WS_URL = 'wss://ws.okx.com:8443/ws/v5/business';
const SYMBOL = 'BTC-USDT-SWAP'; // OKX format for BTC futures
const INTERVAL = '1m';

console.log('=== OKX WebSocket Test ===');
console.log(`URL: ${WS_URL} (business WebSocket for candles)`);
console.log(`Symbol: ${SYMBOL}, Interval: ${INTERVAL}`);
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected');
  
  // OKX candle channel format: candle1m, candle5m, candle1H, etc.
  const subscribeMsg = {
    op: 'subscribe',
    args: [
      {
        channel: 'candle1m', // lowercase 'm' for minutes
        instId: SYMBOL,
      },
    ],
  };
  
  console.log('📤 Subscribing to:', JSON.stringify(subscribeMsg, null, 2));
  ws.send(JSON.stringify(subscribeMsg));
  console.log('');
  console.log('Waiting for kline updates...');
  console.log('');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    // Handle subscription confirmation
    if (message.event === 'subscribe') {
      console.log('✅ Subscription confirmed:', message.arg);
      console.log('');
      return;
    }
    
    // Handle subscription error
    if (message.event === 'error') {
      console.error('❌ Subscription error:', message);
      return;
    }
    
    // Handle candle data
    if (message.data && Array.isArray(message.data)) {
      const candleData = message.data[0];
      const timestamp = new Date(parseInt(candleData[0])).toISOString().substring(11, 19);
      
      console.log(`📊 ${timestamp} | Close: ${candleData[4]} | Volume: ${candleData[5]} | Confirm: ${candleData[8]}`);
      console.log('   Full data:', candleData);
      console.log('   Message structure:', {
        hasArg: !!message.arg,
        argChannel: message.arg?.channel,
        argInstId: message.arg?.instId,
        dataLength: message.data.length,
      });
      console.log('');
    } else if (message.op === 'ping') {
      console.log('ℹ️ Message: ping');
      ws.send(JSON.stringify({ op: 'pong' }));
    } else {
      console.log('ℹ️ Other message:', Object.keys(message));
    }
  } catch (error) {
    console.error('❌ Error parsing message:', error.message);
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
