/**
 * MEXC WebSocket Test
 * Tests raw WebSocket connection to verify data structure
 */

const WebSocket = require('ws');

const WS_URL = 'wss://contract.mexc.com/edge';
const SYMBOL = 'BTC_USDT';
const INTERVAL = 'Min15';

console.log('=== MEXC Futures WebSocket Test ===');
console.log(`URL: ${WS_URL}`);
console.log(`Symbol: ${SYMBOL}, Interval: ${INTERVAL}`);
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected');
  
  // MEXC futures subscription format
  const subscribeMsg = {
    method: 'sub.kline',
    param: {
      symbol: SYMBOL,
      interval: INTERVAL,
    },
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
    if (message.code === 0 || message.msg === 'SUCCESS') {
      console.log('✅ Subscription confirmed:', message);
      console.log('');
      return;
    }
    
    // Handle ping/pong
    if (message.channel === 'pong') {
      console.log('🏓 Pong received');
      return;
    }
    
    // Handle subscription error
    if (message.code && message.code !== 0) {
      console.error('❌ Subscription error:', message);
      return;
    }
    
    // Handle kline data
    if (message.data && message.data.kline) {
      const k = message.data.kline;
      const timestamp = new Date(k.t).toISOString().substring(11, 19);
      
      console.log(`📊 ${timestamp} | O: ${k.o} H: ${k.h} L: ${k.l} C: ${k.c} V: ${k.v} | Closed: ${k.x}`);
      console.log('   Full data:', k);
      console.log('   Message structure:', {
        channel: message.channel,
        symbol: message.symbol,
        hasData: !!message.data,
        hasKline: !!message.data?.kline
      });
      console.log('');
    } else {
      console.log('ℹ️ Other message:', JSON.stringify(message).substring(0, 200));
    }
  } catch (error) {
    console.error('❌ Error parsing message:', error.message);
    console.log('Raw data:', data.toString().substring(0, 200));
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`❌ Connection closed (code: ${code})`);
  process.exit(0);
});

// Send ping every 20 seconds
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    console.log('🏓 Sending ping');
    ws.send(JSON.stringify({ method: 'ping' }));
  }
}, 20000);

// Keep alive for 60 seconds
setTimeout(() => {
  console.log('⏱️ Test complete (60s timeout)');
  ws.close();
}, 60000);
