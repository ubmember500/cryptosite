/**
 * Bitget WebSocket Test
 * Tests raw WebSocket connection to verify data structure
 */

const WebSocket = require('ws');

const WS_URL = 'wss://ws.bitget.com/v2/ws/public';
const SYMBOL = 'BTCUSDT';
const INTERVAL = '15m';

console.log('=== Bitget WebSocket Test ===');
console.log(`URL: ${WS_URL}`);
console.log(`Symbol: ${SYMBOL}, Interval: ${INTERVAL}`);
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected');
  
  // Bitget subscription format
  const subscribeMsg = {
    op: 'subscribe',
    args: [
      {
        instType: 'USDT-FUTURES',
        channel: 'candle15m',
        instId: SYMBOL,
      },
    ],
  };
  
  console.log('📤 Subscribing to:', JSON.stringify(subscribeMsg, null, 2));
  ws.send(JSON.stringify(subscribeMsg));
  console.log('');
  console.log('Waiting for kline updates...');
  console.log('');
  
  // Start ping
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log('🏓 Sending ping');
      ws.send('ping');
    }
  }, 30000);
});

ws.on('message', (data) => {
  try {
    const dataStr = data.toString();
    
    // Handle pong response
    if (dataStr === 'pong') {
      console.log('🏓 Pong received');
      return;
    }
    
    const message = JSON.parse(dataStr);
    
    // Handle subscription confirmation
    if (message.event === 'subscribe') {
      console.log('✅ Subscription confirmed:', message);
      console.log('');
      return;
    }
    
    // Handle subscription error
    if (message.event === 'error' || message.code) {
      console.error('❌ Subscription error:', message);
      return;
    }
    
    // Handle kline data
    if (message.data && Array.isArray(message.data)) {
      const candle = message.data[0];
      const timestamp = new Date(parseInt(candle[0])).toISOString().substring(11, 19);
      
      console.log(`📊 ${timestamp} | O: ${candle[1]} H: ${candle[2]} L: ${candle[3]} C: ${candle[4]} V: ${candle[5]}`);
      console.log('   Full data:', candle);
      console.log('   Message structure:', {
        action: message.action,
        arg: message.arg,
        dataLength: message.data.length
      });
      console.log('');
    } else {
      console.log('ℹ️ Other message:', message);
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
