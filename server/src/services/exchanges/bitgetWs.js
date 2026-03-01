/**
 * Bitget WebSocket Adapter
 * Handles WebSocket connections to Bitget for real-time kline data
 */

const WebSocket = require('ws');

// WebSocket URLs
const FUTURES_WS_URL = 'wss://ws.bitget.com/v2/ws/public';
const SPOT_WS_URL = 'wss://ws.bitget.com/v2/ws/public';

// Reconnection settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 30000; // Bitget requires ping every 30s

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
 * Map interval to Bitget WebSocket format
 * Bitget WebSocket uses same format for both spot and futures: 1m, 5m, 15m, 30m, 1H, 4H, 1D
 */
function mapIntervalToBitget(interval, exchangeType = 'futures') {
  // WebSocket uses consistent format (short form with capital H)
  const map = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1H',
    '4h': '4H',
    '1d': '1D',
  };
  return map[interval] || interval;
}

class BitgetWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.lastKlines1m = new Map();
    
    console.log('[BitgetWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    // Normalize symbol to uppercase (Bitget requires uppercase)
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    
    if (this.subscriptions.has(subscriptionKey)) {
      console.log(`[BitgetWs] Already subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[BitgetWs] Subscribing: ${subscriptionKey} (normalized from ${symbol})`);
    
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
      console.error(`[BitgetWs] Failed to create WebSocket for ${subscriptionKey}:`, error.message);
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
      console.log(`[BitgetWs] Connected: ${subscriptionKey}`);
      subscription.reconnectAttempts = 0;

      // Subscribe to candle stream
      const bitgetInterval = mapIntervalToBitget(wsInterval, exchangeType);
      const instType = exchangeType === 'futures' ? 'USDT-FUTURES' : 'SPOT';
      
      const subscribeMsg = {
        op: 'subscribe',
        args: [
          {
            instType,
            channel: 'candle' + bitgetInterval,
            instId: symbol,
          },
        ],
      };
      
      console.log(`[BitgetWs] Subscribing to channel: candle${bitgetInterval}, instType: ${instType}, instId: ${symbol}`);
      ws.send(JSON.stringify(subscribeMsg));

      // Set timeout to detect failed subscription
      subscription.subscriptionTimeout = setTimeout(() => {
        if (!subscription.confirmed) {
          console.error(`[BitgetWs] ⏱️ Subscription timeout for ${subscriptionKey} - no confirmation received in 10s`);
          // Trigger reconnection
          ws.close();
        }
      }, 10000); // 10 second timeout

      // Start ping timer
      subscription.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
          console.log(`[BitgetWs] Ping sent for ${subscriptionKey}`);
        } else {
          console.warn(`[BitgetWs] Cannot ping, socket not open: ${subscriptionKey}, state: ${ws.readyState}`);
        }
      }, PING_INTERVAL_MS);
      console.log(`[BitgetWs] Ping timer started (interval: ${PING_INTERVAL_MS}ms)`);
    });

    ws.on('message', (data) => {
      try {
        const dataStr = data.toString();
        
        // Handle pong response
        if (dataStr === 'pong') {
          console.log(`[BitgetWs] Pong received for ${subscriptionKey}`);
          return;
        }
        
        const message = JSON.parse(dataStr);
        
        // Handle subscription confirmation
        if (message.event === 'subscribe') {
          console.log(`[BitgetWs] ✅ Subscription confirmed: ${subscriptionKey}`, message.arg);
          subscription.confirmed = true;
          // Clear subscription timeout
          if (subscription.subscriptionTimeout) {
            clearTimeout(subscription.subscriptionTimeout);
            subscription.subscriptionTimeout = null;
          }
          return;
        }
        
        // Handle error
        if (message.event === 'error' || message.code) {
          console.error(`[BitgetWs] ❌ Error: ${subscriptionKey}`, message);
          return;
        }
        
        // Handle candle data
        if (message.data && Array.isArray(message.data)) {
          console.log(`[BitgetWs] Kline message received for ${subscriptionKey}, action: ${message.action}, count: ${message.data.length}`);
          this.handleMessage(message, symbol, targetInterval, exchangeType);
        } else if (message.arg) {
          // Log unexpected message format
          console.warn(`[BitgetWs] Unexpected message for ${subscriptionKey}:`, Object.keys(message), message.action);
        }
      } catch (error) {
        console.error(`[BitgetWs] Error parsing message for ${subscriptionKey}:`, error.message, data.toString().substring(0, 200));
      }
    });

    ws.on('close', (code, reason) => {
      console.warn(`[BitgetWs] Connection closed: ${subscriptionKey} (code: ${code})`);
      
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
      console.error(`[BitgetWs] WebSocket error for ${subscriptionKey}:`, error.message);
    });
  }

  handleMessage(message, symbol, targetInterval, exchangeType) {
    // Validate message structure
    if (!message.data || !Array.isArray(message.data) || message.data.length === 0) {
      console.warn('[BitgetWs] Invalid message structure - no data array:', JSON.stringify(message).substring(0, 200));
      return;
    }

    // Bitget sends two types of messages:
    // - "snapshot": 500 historical candles on first connection
    // - "update": single real-time candle update
    
    let candleData;
    if (message.action === 'snapshot') {
      // Take the LAST candle from snapshot (most recent) for immediate update
      console.log(`[BitgetWs] Snapshot received with ${message.data.length} candles, using latest for immediate update`);
      candleData = message.data[message.data.length - 1];
    } else if (message.action === 'update') {
      // Regular real-time update
      candleData = message.data[0];
    } else {
      console.warn(`[BitgetWs] Unknown action: ${message.action}, ignoring`);
      return;
    }
    
    // Validate candle data is an array
    if (!Array.isArray(candleData) || candleData.length < 6) {
      console.error('[BitgetWs] Invalid candle data format:', {
        isArray: Array.isArray(candleData),
        length: candleData?.length,
        data: candleData
      });
      return;
    }
    
    // Bitget candle format: [timestamp_ms, open, high, low, close, volume, volumeUsd, volumeUsd]
    const kline = {
      time: Math.floor(parseInt(candleData[0]) / 1000), // Convert ms to seconds
      open: parseFloat(candleData[1]),
      high: parseFloat(candleData[2]),
      low: parseFloat(candleData[3]),
      close: parseFloat(candleData[4]),
      volume: parseFloat(candleData[5]),
      isClosed: false, // Bitget doesn't provide explicit closed flag, detect by time change
    };

    console.log('[BitgetWs] Processing kline:', {
      symbol,
      targetInterval,
      exchangeType,
      action: message.action,
      close: kline.close,
      volume: kline.volume,
      isClosed: kline.isClosed,
      time: new Date(kline.time * 1000).toISOString(),
      rawTimestamp: candleData[0]
    });

    // Define klineKey for tracking last candle state
    const klineKey = `${symbol}:${exchangeType}`;
    const lastKline = this.lastKlines1m.get(klineKey);
    
    // Detect closed candles by comparing timestamps
    if (lastKline && lastKline.time < kline.time) {
      console.log('[BitgetWs] New candle detected, marking previous as closed');
      lastKline.isClosed = true;
    }

    // Handle sub-minute intervals - resample from 1m data
    if (['1s', '5s', '15s'].includes(targetInterval)) {
      console.log(`[BitgetWs] Sub-minute interval detected: ${targetInterval}, will resample from 1m`);
      const isNewOrUpdated = !lastKline || lastKline.time !== kline.time || 
                             lastKline.close !== kline.close;
      
      if (isNewOrUpdated) {
        this.lastKlines1m.set(klineKey, { ...kline });
        const subCandles = resample1mToSeconds(kline, targetInterval);
        console.log(`[BitgetWs] Resampled 1m into ${subCandles.length} ${targetInterval} candles`);
        subCandles.forEach((subCandle, index) => {
          console.log(`[BitgetWs] Calling onKlineUpdate for sub-candle ${index + 1}/${subCandles.length}`);
          this.onKlineUpdate(symbol, targetInterval, exchangeType, subCandle);
        });
      } else {
        console.log(`[BitgetWs] Skipping duplicate 1m candle (no changes)`);
      }
    } else {
      // Direct interval match - emit as-is
      console.log(`[BitgetWs] Direct interval match, calling onKlineUpdate`);
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
      console.error(`[BitgetWs] Max reconnection attempts reached for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      return;
    }

    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    console.log(`[BitgetWs] Reconnecting ${subscriptionKey} in ${delay}ms (attempt ${subscription.reconnectAttempts})`);

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
      console.log(`[BitgetWs] Not subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[BitgetWs] Unsubscribing: ${subscriptionKey}`);

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
        const bitgetInterval = mapIntervalToBitget(subscription.wsInterval, exchangeType);
        const instType = exchangeType === 'futures' ? 'USDT-FUTURES' : 'SPOT';
        
        const unsubscribeMsg = {
          op: 'unsubscribe',
          args: [
            {
              instType,
              channel: 'candle' + bitgetInterval,
              instId: symbol,
            },
          ],
        };
        subscription.ws.send(JSON.stringify(unsubscribeMsg));
        subscription.ws.close();
      } catch (error) {
        console.error(`[BitgetWs] Error closing WebSocket for ${subscriptionKey}:`, error.message);
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
    console.log('[BitgetWs] Closing all connections...');

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
          console.error(`[BitgetWs] Error closing ${key}:`, error.message);
        }
      }
    }

    this.subscriptions.clear();
    this.lastKlines1m.clear();

    console.log('[BitgetWs] All connections closed');
  }
}

module.exports = BitgetWsAdapter;
