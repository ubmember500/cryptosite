/**
 * Gate.io WebSocket Adapter
 * Handles WebSocket connections to Gate.io for real-time kline data
 */

const WebSocket = require('ws');

// WebSocket URLs
const FUTURES_WS_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
const SPOT_WS_URL = 'wss://api.gateio.ws/ws/v4/';

// Reconnection settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 15000; // Gate.io requires ping every 15s

/**
 * Resample 1-minute klines into second-interval klines
 */
function _lcg(seed) { let s = seed | 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function resample1mToSeconds(kline1m, secondInterval) {
  const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  const N = 60 / spanSec;
  const result = [];
  const { time: openTimeSec, open, high, low, close, volume, isClosed: parentClosed } = kline1m;
  const volumePerSub = volume / N;
  const range = high - low;
  if (range === 0) {
    for (let i = 0; i < N; i++) {
      result.push({ time: openTimeSec + i * spanSec, open, high, low, close, volume: volumePerSub, isClosed: parentClosed && i === N - 1 });
    }
    return result;
  }
  const rng = _lcg(openTimeSec * 7 + spanSec);
  const isGreen = close >= open;
  const halfN = Math.max(1, Math.floor(N / 2));
  let hiIdx, loIdx;
  if (isGreen) { loIdx = 1 + Math.floor(rng() * halfN); hiIdx = halfN + Math.floor(rng() * (N - halfN)); }
  else { hiIdx = 1 + Math.floor(rng() * halfN); loIdx = halfN + Math.floor(rng() * (N - halfN)); }
  hiIdx = Math.min(hiIdx, N - 1); loIdx = Math.min(loIdx, N - 1);
  if (hiIdx === loIdx) { hiIdx = Math.min(hiIdx + 1, N - 1); if (hiIdx === loIdx) loIdx = Math.max(1, loIdx - 1); }
  const prices = new Array(N + 1);
  prices[0] = open; prices[N] = close; prices[hiIdx] = high; prices[loIdx] = low;
  const sorted = [...new Set([0, hiIdx, loIdx, N])].sort((a, b) => a - b);
  for (let s = 0; s < sorted.length - 1; s++) {
    const from = sorted[s], to = sorted[s + 1];
    for (let i = from + 1; i < to; i++) {
      const t = (i - from) / (to - from);
      const base = prices[from] + (prices[to] - prices[from]) * t;
      const noise = (rng() - 0.5) * range * 0.18;
      prices[i] = Math.min(high, Math.max(low, base + noise));
    }
  }
  for (let i = 0; i < N; i++) {
    const sO = prices[i], sC = prices[i + 1];
    const bodyHi = Math.max(sO, sC), bodyLo = Math.min(sO, sC);
    const wick = range * (0.002 + rng() * 0.014);
    result.push({ time: openTimeSec + i * spanSec, open: sO, high: Math.min(high, bodyHi + wick), low: Math.max(low, bodyLo - wick), close: sC, volume: volumePerSub, isClosed: parentClosed && i === N - 1 });
  }
  return result;
}

/**
 * Map interval to Gate.io format
 */
function mapIntervalToGate(interval) {
  const map = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };
  return map[interval] || interval;
}

/**
 * Format symbol for Gate.io (e.g., BTCUSDT -> BTC_USDT)
 */
function formatSymbolForGate(symbol) {
  // Gate.io uses underscore format
  return symbol.replace('USDT', '_USDT');
}

class GateWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.lastKlines1m = new Map();
    
    console.log('[GateWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    // Normalize symbol to uppercase (Gate.io requires uppercase)
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    
    if (this.subscriptions.has(subscriptionKey)) {
      console.log(`[GateWs] Already subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[GateWs] Subscribing: ${subscriptionKey} (normalized from ${symbol})`);
    
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    const wsInterval = isSubMinute ? '1m' : interval;
    
    this.connectStream(normalizedSymbol, wsInterval, interval, exchangeType, subscriptionKey);
  }

  connectStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;

    let ws;
    try {
      ws = new WebSocket(baseUrl);
    } catch (error) {
      console.error(`[GateWs] Failed to create WebSocket for ${subscriptionKey}:`, error.message);
      this.scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, 0);
      return;
    }

    const subscription = {
      ws,
      reconnectAttempts: 0,
      reconnectTimer: null,
      pingTimer: null,
      subscriptionTimeout: null,
      confirmed: false,
      symbol,
      wsInterval,
      targetInterval,
      exchangeType,
    };

    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => {
      console.log(`[GateWs] Connected: ${subscriptionKey}`);
      subscription.reconnectAttempts = 0;

      // Subscribe to candlestick stream
      const gateSymbol = formatSymbolForGate(symbol);
      const gateInterval = mapIntervalToGate(wsInterval);
      
      const channel = exchangeType === 'futures' ? 'futures.candlesticks' : 'spot.candlesticks';
      const subscribeMsg = {
        time: Math.floor(Date.now() / 1000),
        channel,
        event: 'subscribe',
        payload: [gateInterval, gateSymbol],
      };
      
      console.log(`[GateWs] Subscribing to channel: ${channel}, interval: ${gateInterval}, symbol: ${gateSymbol}`);
      ws.send(JSON.stringify(subscribeMsg));

      // Set timeout to detect failed subscription
      subscription.subscriptionTimeout = setTimeout(() => {
        if (!subscription.confirmed) {
          console.error(`[GateWs] ⏱️ Subscription timeout for ${subscriptionKey} - no confirmation received in 10s`);
          // Trigger reconnection
          ws.close();
        }
      }, 10000); // 10 second timeout

      // Start ping timer
      subscription.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ channel, event: 'ping' }));
          console.log(`[GateWs] Ping sent for ${subscriptionKey}`);
        } else {
          console.warn(`[GateWs] Cannot ping, socket not open: ${subscriptionKey}, state: ${ws.readyState}`);
        }
      }, PING_INTERVAL_MS);
      console.log(`[GateWs] Ping timer started (interval: ${PING_INTERVAL_MS}ms)`);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle pong response
        if (message.event === 'pong') {
          console.log(`[GateWs] Pong received for ${subscriptionKey}`);
          return;
        }
        
        // Handle subscription confirmation
        if (message.event === 'subscribe') {
          console.log(`[GateWs] ✅ Subscription confirmed: ${subscriptionKey}`, message.result);
          subscription.confirmed = true;
          // Clear subscription timeout
          if (subscription.subscriptionTimeout) {
            clearTimeout(subscription.subscriptionTimeout);
            subscription.subscriptionTimeout = null;
          }
          return;
        }
        
        // Handle error response
        if (message.event === 'error' || message.error) {
          console.error(`[GateWs] ❌ Error: ${subscriptionKey}`, message);
          return;
        }
        
        // Handle candlestick update
        if (message.event === 'update' && message.result) {
          console.log(`[GateWs] Kline message received for ${subscriptionKey}, channel: ${message.channel}`);
          this.handleMessage(message, symbol, targetInterval, exchangeType);
        } else {
          // Log unexpected message format
          console.warn(`[GateWs] Unexpected message for ${subscriptionKey}:`, Object.keys(message), message.event);
        }
      } catch (error) {
        console.error(`[GateWs] Error parsing message for ${subscriptionKey}:`, error.message, data.toString().substring(0, 200));
      }
    });

    ws.on('close', (code, reason) => {
      console.warn(`[GateWs] Connection closed: ${subscriptionKey} (code: ${code})`);
      
      if (subscription.pingTimer) {
        clearInterval(subscription.pingTimer);
      }
      
      if (subscription.subscriptionTimeout) {
        clearTimeout(subscription.subscriptionTimeout);
      }
      
      if (this.subscriptions.has(subscriptionKey)) {
        this.scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, subscription.reconnectAttempts);
      }
    });

    ws.on('error', (error) => {
      console.error(`[GateWs] WebSocket error for ${subscriptionKey}:`, error.message);
    });
  }

  handleMessage(message, symbol, targetInterval, exchangeType) {
    // Validate message structure
    if (!message.result) {
      console.warn('[GateWs] Invalid message structure - no result:', JSON.stringify(message).substring(0, 200));
      return;
    }

    // Gate.io returns different formats:
    // - Spot: result is an object
    // - Futures: result is an array with one object
    const candleData = Array.isArray(message.result) ? message.result[0] : message.result;
    
    if (!candleData || !candleData.t) {
      console.warn('[GateWs] Invalid candle data - no timestamp:', candleData);
      return;
    }
    
    // Validate required fields
    if (!candleData.c || !candleData.o || !candleData.h || !candleData.l) {
      console.error('[GateWs] Missing required fields in kline data:', {
        hasClose: !!candleData.c,
        hasOpen: !!candleData.o,
        hasHigh: !!candleData.h,
        hasLow: !!candleData.l,
        data: candleData
      });
      return;
    }
    
    // Gate.io candle format: { t: timestamp, v: volume, c: close, h: high, l: low, o: open, n: name, w: closed, a: amount }
    // w: true means candle is closed/confirmed
    // v: volume field (spot uses string volume in quote currency, futures uses integer contract count)
    const kline = {
      time: parseInt(candleData.t),
      open: parseFloat(candleData.o),
      high: parseFloat(candleData.h),
      low: parseFloat(candleData.l),
      close: parseFloat(candleData.c),
      volume: parseFloat(candleData.v || candleData.a || 0), // Try v first, fallback to a (amount)
      isClosed: candleData.w === true, // Gate.io uses 'w' field for closed status
    };

    console.log('[GateWs] Processing kline:', {
      symbol,
      targetInterval,
      exchangeType,
      close: kline.close,
      volume: kline.volume,
      isClosed: kline.isClosed,
      time: new Date(kline.time * 1000).toISOString(),
      gateSymbolName: candleData.n,
      rawW: candleData.w
    });

    // Define klineKey for tracking last candle state
    const klineKey = `${symbol}:${exchangeType}`;

    // Handle sub-minute intervals - resample from 1m data
    if (['1s', '5s', '15s'].includes(targetInterval)) {
      console.log(`[GateWs] Sub-minute interval detected: ${targetInterval}, will resample from 1m`);
      const lastKline = this.lastKlines1m.get(klineKey);
      
      const isNewOrUpdated = !lastKline || lastKline.time !== kline.time || 
                             lastKline.close !== kline.close || lastKline.isClosed !== kline.isClosed;
      
      if (isNewOrUpdated) {
        this.lastKlines1m.set(klineKey, { ...kline });
        const subCandles = resample1mToSeconds(kline, targetInterval);
        console.log(`[GateWs] Resampled 1m into ${subCandles.length} ${targetInterval} candles`);
        subCandles.forEach((subCandle, index) => {
          console.log(`[GateWs] Calling onKlineUpdate for sub-candle ${index + 1}/${subCandles.length}`);
          this.onKlineUpdate(symbol, targetInterval, exchangeType, subCandle);
        });
      } else {
        console.log(`[GateWs] Skipping duplicate 1m candle (no changes)`);
      }
    } else {
      // Direct interval match - emit as-is
      console.log(`[GateWs] Direct interval match, calling onKlineUpdate`);
      this.lastKlines1m.set(klineKey, { ...kline });
      this.onKlineUpdate(symbol, targetInterval, exchangeType, kline);
    }
  }

  scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, attempts) {
    if (!this.subscriptions.has(subscriptionKey)) {
      return;
    }

    const subscription = this.subscriptions.get(subscriptionKey);
    subscription.reconnectAttempts = attempts + 1;

    if (subscription.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[GateWs] Max reconnection attempts reached for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      return;
    }

    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    console.log(`[GateWs] Reconnecting ${subscriptionKey} in ${delay}ms (attempt ${subscription.reconnectAttempts})`);

    subscription.reconnectTimer = setTimeout(() => {
      if (this.subscriptions.has(subscriptionKey)) {
        this.connectStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey);
      }
    }, delay);
  }

  unsubscribe(symbol, interval, exchangeType) {
    const subscriptionKey = `${symbol}:${interval}:${exchangeType}`;
    
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) {
      console.log(`[GateWs] Not subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[GateWs] Unsubscribing: ${subscriptionKey}`);

    if (subscription.reconnectTimer) {
      clearTimeout(subscription.reconnectTimer);
    }

    if (subscription.pingTimer) {
      clearInterval(subscription.pingTimer);
    }

    if (subscription.subscriptionTimeout) {
      clearTimeout(subscription.subscriptionTimeout);
    }

    if (subscription.ws && subscription.ws.readyState === WebSocket.OPEN) {
      try {
        const gateSymbol = formatSymbolForGate(symbol);
        const gateInterval = mapIntervalToGate(subscription.wsInterval);
        const channel = exchangeType === 'futures' ? 'futures.candlesticks' : 'spot.candlesticks';
        
        const unsubscribeMsg = {
          time: Math.floor(Date.now() / 1000),
          channel,
          event: 'unsubscribe',
          payload: [gateInterval, gateSymbol],
        };
        subscription.ws.send(JSON.stringify(unsubscribeMsg));
        subscription.ws.close();
      } catch (error) {
        console.error(`[GateWs] Error closing WebSocket for ${subscriptionKey}:`, error.message);
      }
    }

    this.subscriptions.delete(subscriptionKey);

    const klineKey = `${symbol}:${exchangeType}`;
    const hasSubMinuteSubs = Array.from(this.subscriptions.keys()).some((key) => {
      const [s, i, e] = key.split(':');
      return s === symbol && e === exchangeType && ['1s', '5s', '15s'].includes(i);
    });
    if (!hasSubMinuteSubs) {
      this.lastKlines1m.delete(klineKey);
    }
  }

  close() {
    console.log('[GateWs] Closing all connections...');

    for (const [key, subscription] of this.subscriptions) {
      if (subscription.reconnectTimer) {
        clearTimeout(subscription.reconnectTimer);
      }
      if (subscription.pingTimer) {
        clearInterval(subscription.pingTimer);
      }
      if (subscription.subscriptionTimeout) {
        clearTimeout(subscription.subscriptionTimeout);
      }
      if (subscription.ws) {
        try {
          subscription.ws.close();
        } catch (error) {
          console.error(`[GateWs] Error closing ${key}:`, error.message);
        }
      }
    }

    this.subscriptions.clear();
    this.lastKlines1m.clear();

    console.log('[GateWs] All connections closed');
  }
}

module.exports = GateWsAdapter;
