/**
 * Binance WebSocket Adapter
 * Handles WebSocket connections to Binance for real-time kline data
 */

const WebSocket = require('ws');

// WebSocket URLs
const FUTURES_WS_URL = 'wss://fstream.binance.com/ws';
const SPOT_WS_URL = 'wss://stream.binance.com:9443/ws';

// Reconnection settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Resample 1-minute klines into second-interval klines (1s, 5s, 15s).
 * Binance does not provide second-level klines; we split each 1m candle into N sub-candles
 * with the same OHLC (flat) and volume distributed evenly.
 * @param {Object} kline1m - 1m candle
 * @param {string} secondInterval - '1s', '5s', or '15s'
 * @returns {Array} Array of sub-candles
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

class BinanceWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate; // Callback: (symbol, interval, exchangeType, klineData)
    
    // Map of subscription key -> { ws, reconnectAttempts, reconnectTimer, lastKline1m }
    // subscription key format: "symbol:interval:exchangeType"
    this.subscriptions = new Map();
    
    // Track pending 1m klines for sub-minute intervals
    // key: "symbol:exchangeType", value: lastKline1m
    this.lastKlines1m = new Map();
    
    console.log('[BinanceWs] Adapter initialized');
  }

  /**
   * Subscribe to kline updates
   * @param {string} symbol - Trading pair (e.g., BTCUSDT)
   * @param {string} interval - Time interval (1s, 5s, 15s, 1m, 5m, 15m, 30m, 1h, 4h, 1d)
   * @param {string} exchangeType - 'futures' or 'spot'
   */
  subscribe(symbol, interval, exchangeType) {
    const subscriptionKey = `${symbol}:${interval}:${exchangeType}`;
    
    if (this.subscriptions.has(subscriptionKey)) {
      console.log(`[BinanceWs] Already subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[BinanceWs] Subscribing: ${subscriptionKey}`);
    
    // For sub-minute intervals, subscribe to 1m and resample
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    const wsInterval = isSubMinute ? '1m' : interval;
    
    this.connectStream(symbol, wsInterval, interval, exchangeType, subscriptionKey);
  }

  /**
   * Connect to WebSocket stream
   * @param {string} symbol - Trading pair
   * @param {string} wsInterval - Interval to subscribe on WebSocket (1m, 5m, etc.)
   * @param {string} targetInterval - Target interval for output (may differ for sub-minute)
   * @param {string} exchangeType - 'futures' or 'spot'
   * @param {string} subscriptionKey - Unique key for this subscription
   */
  connectStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;
    const streamName = `${symbol.toLowerCase()}@kline_${wsInterval}`;
    const url = `${baseUrl}/${streamName}`;

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      console.error(`[BinanceWs] Failed to create WebSocket for ${subscriptionKey}:`, error.message);
      this.scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, 0);
      return;
    }

    const subscription = {
      ws,
      reconnectAttempts: 0,
      reconnectTimer: null,
      symbol,
      wsInterval,
      targetInterval,
      exchangeType,
    };

    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => {
      console.log(`[BinanceWs] Connected: ${subscriptionKey}`);
      subscription.reconnectAttempts = 0;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message, targetInterval, exchangeType);
      } catch (error) {
        console.error(`[BinanceWs] Error parsing message for ${subscriptionKey}:`, error.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.warn(`[BinanceWs] Connection closed: ${subscriptionKey} (code: ${code}, reason: ${reason || 'none'})`);
      
      if (this.subscriptions.has(subscriptionKey)) {
        this.scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, subscription.reconnectAttempts);
      }
    });

    ws.on('error', (error) => {
      console.error(`[BinanceWs] WebSocket error for ${subscriptionKey}:`, error.message);
    });
  }

  /**
   * Handle incoming WebSocket message
   * @param {Object} message - Parsed message
   * @param {string} targetInterval - Target interval
   * @param {string} exchangeType - 'futures' or 'spot'
   */
  handleMessage(message, targetInterval, exchangeType) {
    const k = message.k;
    if (!k) return;

    const symbol = k.s; // e.g., "BTCUSDT"
    const interval = k.i; // e.g., "1m"

    // Parse kline data
    const kline = {
      time: Math.floor(k.t / 1000), // Convert ms to seconds
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x, // true when candle is finalized
    };

    // Log occasionally for debugging
    if (Math.random() < 0.01) {
      console.log('[BinanceWs] Kline data received:', {
        symbol,
        interval,
        close: kline.close,
        isClosed: kline.isClosed,
      });
    }

    // If target is sub-minute, resample
    if (['1s', '5s', '15s'].includes(targetInterval) && interval === '1m') {
      const klineKey = `${symbol}:${exchangeType}`;
      const lastKline = this.lastKlines1m.get(klineKey);
      
      // Only emit when 1m candle changes (new candle or update)
      const isNewOrUpdated = !lastKline || lastKline.time !== kline.time || 
                             lastKline.close !== kline.close || lastKline.isClosed !== kline.isClosed;
      
      if (isNewOrUpdated) {
        this.lastKlines1m.set(klineKey, kline);
        
        // Resample and emit all sub-candles
        const subCandles = resample1mToSeconds(kline, targetInterval);
        subCandles.forEach((subCandle) => {
          this.onKlineUpdate(symbol, targetInterval, exchangeType, subCandle);
        });
      }
    } else {
      // Direct interval match - emit as-is
      this.onKlineUpdate(symbol, interval, exchangeType, kline);
    }
  }

  /**
   * Schedule reconnection attempt
   * @param {string} symbol - Trading pair
   * @param {string} wsInterval - WebSocket interval
   * @param {string} targetInterval - Target interval
   * @param {string} exchangeType - 'futures' or 'spot'
   * @param {string} subscriptionKey - Subscription key
   * @param {number} attempts - Current attempt count
   */
  scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, attempts) {
    if (!this.subscriptions.has(subscriptionKey)) {
      return; // Subscription was removed, don't reconnect
    }

    const subscription = this.subscriptions.get(subscriptionKey);
    subscription.reconnectAttempts = attempts + 1;

    if (subscription.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[BinanceWs] Max reconnection attempts reached for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      return;
    }

    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    console.log(`[BinanceWs] Reconnecting ${subscriptionKey} in ${delay}ms (attempt ${subscription.reconnectAttempts})`);

    subscription.reconnectTimer = setTimeout(() => {
      if (this.subscriptions.has(subscriptionKey)) {
        this.connectStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey);
      }
    }, delay);
  }

  /**
   * Unsubscribe from kline updates
   * @param {string} symbol - Trading pair
   * @param {string} interval - Time interval
   * @param {string} exchangeType - 'futures' or 'spot'
   */
  unsubscribe(symbol, interval, exchangeType) {
    const subscriptionKey = `${symbol}:${interval}:${exchangeType}`;
    
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) {
      console.log(`[BinanceWs] Not subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[BinanceWs] Unsubscribing: ${subscriptionKey}`);

    // Clear reconnect timer
    if (subscription.reconnectTimer) {
      clearTimeout(subscription.reconnectTimer);
    }

    // Close WebSocket
    if (subscription.ws) {
      try {
        subscription.ws.close();
      } catch (error) {
        console.error(`[BinanceWs] Error closing WebSocket for ${subscriptionKey}:`, error.message);
      }
    }

    // Remove subscription
    this.subscriptions.delete(subscriptionKey);

    // Clean up 1m cache if no more sub-minute subscriptions for this symbol
    const klineKey = `${symbol}:${exchangeType}`;
    const hasSubMinuteSubs = Array.from(this.subscriptions.keys()).some((key) => {
      const [s, i, e] = key.split(':');
      return s === symbol && e === exchangeType && ['1s', '5s', '15s'].includes(i);
    });
    if (!hasSubMinuteSubs) {
      this.lastKlines1m.delete(klineKey);
    }
  }

  /**
   * Close all connections
   */
  close() {
    console.log('[BinanceWs] Closing all connections...');

    for (const [key, subscription] of this.subscriptions) {
      if (subscription.reconnectTimer) {
        clearTimeout(subscription.reconnectTimer);
      }
      if (subscription.ws) {
        try {
          subscription.ws.close();
        } catch (error) {
          console.error(`[BinanceWs] Error closing ${key}:`, error.message);
        }
      }
    }

    this.subscriptions.clear();
    this.lastKlines1m.clear();

    console.log('[BinanceWs] All connections closed');
  }
}

module.exports = BinanceWsAdapter;
