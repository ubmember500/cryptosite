/**
 * Gate.io Futures WebSocket Test
 * Tests raw WebSocket connection to verify futures data structure
 */

const WebSocket = require('ws');

const WS_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
const SYMBOL = 'BTC_USDT'; // Gate.io futures format
const INTERVAL = '1m';

console.log('=== Gate.io Futures WebSocket Test ===');
console.log(`URL: ${WS_URL}`);
console.log(`Symbol: ${SYMBOL}, Interval: ${INTERVAL}`);
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected');
  
  // Gate.io futures subscription format
  const subscribeMsg = {
    time: Math.floor(Date.now() / 1000),
    channel: 'futures.candlesticks',
    event: 'subscribe',
    payload: [INTERVAL, SYMBOL],
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
      console.log('✅ Subscription confirmed:', message);
      console.log('');
      return;
    }
    
    // Handle subscription error
    if (message.event === 'error') {
      console.error('❌ Subscription error:', message);
      return;
    }
    
    // Handle kline data
    if (message.event === 'update' && message.channel === 'futures.candlesticks') {
      const result = message.result;
      
      console.log('📊 Raw result data:', result);
      
      if (Array.isArray(result) && result.length > 0) {
        const candle = result[0];
        console.log('   Array format, first item:', candle);
        if (candle.t) {
          const timestamp = new Date(parseInt(candle.t) * 1000).toISOString().substring(11, 19);
          console.log(`   Time: ${timestamp} | Close: ${candle.c} | Volume: ${candle.v}`);
        }
      } else if (result.t) {
        const timestamp = new Date(parseInt(result.t) * 1000).toISOString().substring(11, 19);
        console.log(`   Time: ${timestamp} | Close: ${result.c} | Volume: ${result.v} | Closed: ${result.w}`);
      }
      console.log('');
    } else if (message.event === 'ping') {
      console.log('ℹ️ Ping received, sending pong');
      ws.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: message.channel,
        event: 'pong'
      }));
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
