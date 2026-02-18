/**
 * Simple Bybit WebSocket Test
 * Tests raw WebSocket connection to Bybit to verify data flow
 */

const WebSocket = require('ws');

const FUTURES_WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const symbol = 'BTCUSDT';
const interval = '1'; // 1 minute

console.log('=== Bybit WebSocket Test ===');
console.log(`URL: ${FUTURES_WS_URL}`);
console.log(`Symbol: ${symbol}, Interval: ${interval}m\n`);

const ws = new WebSocket(FUTURES_WS_URL);

ws.on('open', () => {
  console.log('✅ Connected');
  
  const subscribeMsg = {
    op: 'subscribe',
    args: [`kline.${interval}.${symbol}`],
  };
  
  console.log(`📤 Subscribing to: kline.${interval}.${symbol}`);
  ws.send(JSON.stringify(subscribeMsg));
  
  // Start ping
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 'ping' }));
    }
  }, 20000);
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    // Handle pong (silent)
    if (message.op === 'pong') {
      return;
    }
    
    // Handle subscription response
    if (message.op === 'subscribe') {
      if (message.success) {
        console.log('✅ Subscription confirmed\n');
        console.log('Waiting for kline updates...\n');
      } else {
        console.error('❌ Subscription failed:', message);
      }
      return;
    }
    
    // Handle kline data
    if (message.topic && message.topic.startsWith('kline.')) {
      if (message.data && message.data.length > 0) {
        const k = message.data[0];
        const timestamp = new Date(k.start).toLocaleTimeString();
        console.log(`📊 ${timestamp} | ${k.symbol} | Close: ${k.close} | Volume: ${k.volume} | Confirm: ${k.confirm}`);
      }
      return;
    }
    
    // Log any other message type
    console.log('ℹ️ Message:', message.op || message.topic || 'unknown');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 Connection closed (code: ${code})`);
  process.exit(0);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Closing...');
  ws.close();
});
