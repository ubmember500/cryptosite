/**
 * Bybit WebSocket Adapter
 * Handles WebSocket connections to Bybit for real-time kline data
 * 
 * Uses Bybit V5 WebSocket API with subscription messages (different from Binance's URL-based approach)
 */

const WebSocket = require('ws');

// WebSocket URLs - Bybit V5 uses category-specific endpoints
const FUTURES_WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const SPOT_WS_URL = 'wss://stream.bybit.com/v5/public/spot';

// Reconnection settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 20000; // Bybit requires ping every 20 seconds to keep connection alive

/**
 * Resample 1-minute klines into second-interval klines
 */
function resample1mToSeconds(kline1m, secondInterval) {
  const spanSeconds = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  const N = 60 / spanSeconds;
  const result = [];

  const { time: openTimeSec, open, high, low, close, volume, isClosed: parentClosed } = kline1m;
  const volumePerSub = volume / N;
  const range = high - low;

  if (range === 0) {
    for (let i = 0; i < N; i++) {
      result.push({
        time: openTimeSec + i * spanSeconds,
        open, high, low, close,
        volume: volumePerSub,
        isClosed: parentClosed && i === N - 1,
      });
    }
    return result;
  }

  const isGreen = close >= open;
  const seed = openTimeSec % 97;
  const highAt = isGreen ? 0.55 + (seed % 11) * 0.03 : 0.15 + (seed % 11) * 0.03;
  const lowAt  = isGreen ? 0.15 + (seed % 7)  * 0.03 : 0.55 + (seed % 7)  * 0.03;

  const prices = new Array(N + 1);
  prices[0] = open;
  prices[N] = close;

  for (let i = 1; i < N; i++) {
    const t = i / N;
    let p = open + (close - open) * t;
    const hPull = Math.exp(-(((t - highAt) * 5) ** 2));
    const lPull = Math.exp(-(((t - lowAt)  * 5) ** 2));
    p += (high - p) * hPull * 0.85;
    p -= (p - low)  * lPull * 0.85;
    prices[i] = Math.min(high, Math.max(low, p));
  }

  for (let i = 0; i < N; i++) {
    const sOpen  = prices[i];
    const sClose = prices[i + 1];
    const bodyHi = Math.max(sOpen, sClose);
    const bodyLo = Math.min(sOpen, sClose);
    const wick = range * (0.01 + ((openTimeSec + i) % 13) * 0.004);
    result.push({
      time: openTimeSec + i * spanSeconds,
      open:  sOpen,
      high:  Math.min(high, bodyHi + wick),
      low:   Math.max(low,  bodyLo - wick),
      close: sClose,
      volume: volumePerSub,
      isClosed: parentClosed && i === N - 1,
    });
  }

  return result;
}

/**
 * Map interval to Bybit format
 */
function mapIntervalToBybit(interval) {
  const map = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
  };
  return map[interval] || '1'; // Default to 1m if not found
}

class BybitWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.lastKlines1m = new Map();
    
    console.log('[BybitWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    // Normalize symbol to uppercase (Bybit requires uppercase)
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    
    if (this.subscriptions.has(subscriptionKey)) {
      console.log(`[BybitWs] Already subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[BybitWs] Subscribing: ${subscriptionKey} (normalized from ${symbol})`);
    
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
      console.error(`[BybitWs] Failed to create WebSocket for ${subscriptionKey}:`, error.message);
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
      console.log(`[BybitWs] Connected: ${subscriptionKey}`);
      subscription.reconnectAttempts = 0;

      // Subscribe to kline stream - Bybit uses subscription messages
      const bybitInterval = mapIntervalToBybit(wsInterval);
      const subscribeMsg = {
        op: 'subscribe',
        args: [`kline.${bybitInterval}.${symbol}`],
      };
      
      console.log(`[BybitWs] Subscribing to: kline.${bybitInterval}.${symbol}`);
      ws.send(JSON.stringify(subscribeMsg));

      // Set timeout to detect failed subscription
      subscription.subscriptionTimeout = setTimeout(() => {
        if (!subscription.confirmed) {
          console.error(`[BybitWs] ⏱️ Subscription timeout for ${subscriptionKey} - no confirmation received in 10s`);
          // Trigger reconnection
          ws.close();
        }
      }, 10000); // 10 second timeout

      // Start ping timer - Bybit requires regular pings to keep connection alive
      subscription.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 'ping' }));
          console.log(`[BybitWs] Ping sent for ${subscriptionKey}`);
        } else {
          console.warn(`[BybitWs] Cannot ping, socket not open: ${subscriptionKey}, state: ${ws.readyState}`);
        }
      }, PING_INTERVAL_MS);
      console.log(`[BybitWs] Ping timer started (interval: ${PING_INTERVAL_MS}ms)`);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle pong response
        if (message.op === 'pong') {
          console.log(`[BybitWs] Pong received for ${subscriptionKey}`);
          return;
        }
        
        // Handle subscription confirmation
        if (message.op === 'subscribe') {
          if (message.success) {
            console.log(`[BybitWs] ✅ Subscription confirmed: ${subscriptionKey}`);
            subscription.confirmed = true;
            // Clear subscription timeout
            if (subscription.subscriptionTimeout) {
              clearTimeout(subscription.subscriptionTimeout);
              subscription.subscriptionTimeout = null;
            }
          } else {
            console.error(`[BybitWs] ❌ Subscription failed: ${subscriptionKey}`, message);
          }
          return;
        }
        
        // Handle kline data - Bybit sends updates with topic field
        if (message.topic && message.topic.startsWith('kline.')) {
          console.log(`[BybitWs] Kline message received for ${subscriptionKey}, topic: ${message.topic}`);
          this.handleMessage(message, targetInterval, exchangeType);
        } else if (!message.op) {
          // Log unexpected message types
          console.warn(`[BybitWs] Unexpected message type for ${subscriptionKey}:`, Object.keys(message));
        }
      } catch (error) {
        console.error(`[BybitWs] Error parsing message for ${subscriptionKey}:`, error.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.warn(`[BybitWs] Connection closed: ${subscriptionKey} (code: ${code})`);
      
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
      console.error(`[BybitWs] WebSocket error for ${subscriptionKey}:`, error.message);
    });
  }

  /**
   * Handle incoming WebSocket message from Bybit
   * @param {Object} message - Parsed message
   * @param {string} targetInterval - Target interval for output
   * @param {string} exchangeType - 'futures' or 'spot'
   */
  handleMessage(message, targetInterval, exchangeType) {
    // Bybit sends kline data in message.data array
    if (!message.data || !Array.isArray(message.data) || message.data.length === 0) {
      console.warn('[BybitWs] Invalid message structure - no data array:', JSON.stringify(message).substring(0, 200));
      return;
    }

    const k = message.data[0]; // First item contains the kline data
    
    // Extract symbol from topic (format: "kline.15.BTCUSDT")
    const symbol = message.topic ? message.topic.split('.').pop() : null;
    const interval = k.interval; // e.g., "1" or "15"
    
    // Validate required fields
    if (!symbol || !k.start || k.close === undefined) {
      console.error('[BybitWs] Missing required fields in kline data:', {
        hasSymbol: !!symbol,
        hasTopic: !!message.topic,
        hasStart: !!k.start,
        hasClose: k.close !== undefined,
        topic: message.topic,
        data: k
      });
      return;
    }
    
    // Parse kline data - Bybit format
    const kline = {
      time: Math.floor(k.start / 1000), // Convert ms to seconds
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
      isClosed: k.confirm === true, // Bybit uses 'confirm' field
    };

    // Verify interval matches what we subscribed to (for sub-minute, we subscribed to 1m)
    const expectedBybitInterval = ['1s', '5s', '15s'].includes(targetInterval) ? '1' : mapIntervalToBybit(targetInterval);
    
    console.log('[BybitWs] Processing kline:', {
      symbol,
      receivedInterval: interval,
      expectedInterval: expectedBybitInterval,
      targetInterval,
      exchangeType,
      close: kline.close,
      isClosed: kline.isClosed,
      time: new Date(kline.time * 1000).toISOString()
    });

    // Verify interval matches
    if (interval !== expectedBybitInterval) {
      console.warn(`[BybitWs] ⚠️ Interval mismatch: received ${interval}, expected ${expectedBybitInterval} for target ${targetInterval}`);
      // Still process it but log the warning
    }

    // Handle sub-minute intervals - resample from 1m data
    if (['1s', '5s', '15s'].includes(targetInterval) && interval === '1') {
      console.log(`[BybitWs] Sub-minute interval detected: ${targetInterval}, will resample from 1m`);
      const klineKey = `${symbol}:${exchangeType}`;
      const lastKline = this.lastKlines1m.get(klineKey);
      
      // Only emit when 1m candle changes
      const isNewOrUpdated = !lastKline || lastKline.time !== kline.time || 
                             lastKline.close !== kline.close || lastKline.isClosed !== kline.isClosed;
      
      if (isNewOrUpdated) {
        this.lastKlines1m.set(klineKey, kline);
        
        // Resample and emit all sub-candles
        const subCandles = resample1mToSeconds(kline, targetInterval);
        console.log(`[BybitWs] Resampled 1m into ${subCandles.length} ${targetInterval} candles`);
        subCandles.forEach((subCandle, index) => {
          console.log(`[BybitWs] Calling onKlineUpdate for sub-candle ${index + 1}/${subCandles.length}`);
          this.onKlineUpdate(symbol, targetInterval, exchangeType, subCandle);
        });
      } else {
        console.log(`[BybitWs] Skipping duplicate 1m candle (no changes)`);
      }
    } else {
      // Direct interval match - emit as-is (same as Binance)
      console.log(`[BybitWs] Direct interval match, calling onKlineUpdate`);
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
      console.error(`[BybitWs] Max reconnection attempts reached for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      return;
    }

    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    console.log(`[BybitWs] Reconnecting ${subscriptionKey} in ${delay}ms (attempt ${subscription.reconnectAttempts})`);

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
      console.log(`[BybitWs] Not subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[BybitWs] Unsubscribing: ${subscriptionKey}`);

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
        const bybitInterval = mapIntervalToBybit(subscription.wsInterval);
        const unsubscribeMsg = {
          op: 'unsubscribe',
          args: [`kline.${bybitInterval}.${symbol}`],
        };
        subscription.ws.send(JSON.stringify(unsubscribeMsg));
        subscription.ws.close();
      } catch (error) {
        console.error(`[BybitWs] Error closing WebSocket for ${subscriptionKey}:`, error.message);
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
    console.log('[BybitWs] Closing all connections...');

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
          console.error(`[BybitWs] Error closing ${key}:`, error.message);
        }
      }
    }

    this.subscriptions.clear();
    this.lastKlines1m.clear();

    console.log('[BybitWs] All connections closed');
  }
}

module.exports = BybitWsAdapter;
