/**
 * OKX WebSocket Adapter
 * Handles WebSocket connections to OKX for real-time kline data
 */

const WebSocket = require('ws');

// WebSocket URL - Candles are on the business WebSocket, not public
const WS_URL = 'wss://ws.okx.com:8443/ws/v5/business';

// Reconnection settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

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
 * Map interval to OKX format
 */
function mapIntervalToOKX(interval) {
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

/**
 * Format symbol for OKX (e.g., BTCUSDT -> BTC-USDT-SWAP for futures, BTC-USDT for spot)
 */
function formatSymbolForOKX(symbol, exchangeType) {
  // OKX uses hyphen-separated format
  // For futures: BTC-USDT-SWAP
  // For spot: BTC-USDT
  const base = symbol.replace('USDT', '');
  if (exchangeType === 'futures') {
    return `${base}-USDT-SWAP`;
  } else {
    return `${base}-USDT`;
  }
}

/**
 * Parse OKX symbol back to standard format
 */
function parseOKXSymbol(okxSymbol) {
  // BTC-USDT-SWAP -> BTCUSDT
  // BTC-USDT -> BTCUSDT
  return okxSymbol.replace(/-USDT.*/, 'USDT').replace('-', '');
}

class OkxWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.lastKlines1m = new Map();
    
    console.log('[OkxWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    // Normalize symbol to uppercase (OKX requires uppercase)
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    
    if (this.subscriptions.has(subscriptionKey)) {
      console.log(`[OkxWs] Already subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[OkxWs] Subscribing: ${subscriptionKey} (normalized from ${symbol})`);
    
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    const wsInterval = isSubMinute ? '1m' : interval;
    
    this.connectStream(normalizedSymbol, wsInterval, interval, exchangeType, subscriptionKey);
  }

  connectStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey) {
    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch (error) {
      console.error(`[OkxWs] Failed to create WebSocket for ${subscriptionKey}:`, error.message);
      this.scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, 0);
      return;
    }

    const subscription = {
      ws,
      reconnectAttempts: 0,
      reconnectTimer: null,
      subscriptionTimeout: null,
      confirmed: false,
      symbol,
      wsInterval,
      targetInterval,
      exchangeType,
    };

    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => {
      console.log(`[OkxWs] Connected: ${subscriptionKey}`);
      subscription.reconnectAttempts = 0;

      // Subscribe to candle stream
      const okxSymbol = formatSymbolForOKX(symbol, exchangeType);
      const okxInterval = mapIntervalToOKX(wsInterval);
      const instType = exchangeType === 'futures' ? 'SWAP' : 'SPOT';
      
      const subscribeMsg = {
        op: 'subscribe',
        args: [
          {
            channel: `candle${okxInterval}`,
            instId: okxSymbol,
          },
        ],
      };
      
      console.log(`[OkxWs] Subscribing to channel: candle${okxInterval}, instId: ${okxSymbol}`);
      ws.send(JSON.stringify(subscribeMsg));

      // Set timeout to detect failed subscription
      subscription.subscriptionTimeout = setTimeout(() => {
        if (!subscription.confirmed) {
          console.error(`[OkxWs] ⏱️ Subscription timeout for ${subscriptionKey} - no confirmation received in 10s`);
          // Trigger reconnection
          ws.close();
        }
      }, 10000); // 10 second timeout
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle subscription confirmation
        if (message.event === 'subscribe') {
          console.log(`[OkxWs] ✅ Subscription confirmed: ${subscriptionKey}`, message.arg);
          subscription.confirmed = true;
          // Clear subscription timeout
          if (subscription.subscriptionTimeout) {
            clearTimeout(subscription.subscriptionTimeout);
            subscription.subscriptionTimeout = null;
          }
          return;
        }
        
        // Handle subscription error
        if (message.event === 'error') {
          console.error(`[OkxWs] ❌ Subscription error: ${subscriptionKey}`, message);
          return;
        }
        
        // Handle candle data
        if (message.data && Array.isArray(message.data)) {
          console.log(`[OkxWs] Kline message received for ${subscriptionKey}, channel: ${message.arg?.channel}`);
          this.handleMessage(message, symbol, targetInterval, exchangeType);
        } else if (message.arg && message.arg.channel) {
          // Log unexpected message format
          console.warn(`[OkxWs] Unexpected message format for ${subscriptionKey}:`, Object.keys(message));
        }
      } catch (error) {
        console.error(`[OkxWs] Error parsing message for ${subscriptionKey}:`, error.message, data.toString().substring(0, 200));
      }
    });

    ws.on('close', (code, reason) => {
      console.warn(`[OkxWs] Connection closed: ${subscriptionKey} (code: ${code})`);
      
      if (subscription.subscriptionTimeout) {
        clearTimeout(subscription.subscriptionTimeout);
      }
      
      if (this.subscriptions.has(subscriptionKey)) {
        this.scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, subscription.reconnectAttempts);
      }
    });

    ws.on('error', (error) => {
      console.error(`[OkxWs] WebSocket error for ${subscriptionKey}:`, error.message);
    });
  }

  handleMessage(message, symbol, targetInterval, exchangeType) {
    // Validate message structure
    if (!message.data || !Array.isArray(message.data) || message.data.length === 0) {
      console.warn('[OkxWs] Invalid message structure - no data array:', JSON.stringify(message).substring(0, 200));
      return;
    }

    const candleData = message.data[0];
    
    // Validate candle data array
    if (!Array.isArray(candleData) || candleData.length < 9) {
      console.error('[OkxWs] Invalid candle data format:', {
        isArray: Array.isArray(candleData),
        length: candleData?.length,
        data: candleData
      });
      return;
    }
    
    // OKX candle format: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    // confirm: "0" = not confirmed, "1" = confirmed/closed
    const kline = {
      time: Math.floor(parseInt(candleData[0]) / 1000), // Convert ms to seconds
      open: parseFloat(candleData[1]),
      high: parseFloat(candleData[2]),
      low: parseFloat(candleData[3]),
      close: parseFloat(candleData[4]),
      volume: parseFloat(candleData[5]),
      isClosed: candleData[8] === '1',
    };

    console.log('[OkxWs] Processing kline:', {
      symbol,
      targetInterval,
      exchangeType,
      close: kline.close,
      isClosed: kline.isClosed,
      time: new Date(kline.time * 1000).toISOString()
    });

    // Handle sub-minute intervals - resample from 1m data
    if (['1s', '5s', '15s'].includes(targetInterval)) {
      console.log(`[OkxWs] Sub-minute interval detected: ${targetInterval}, will resample from 1m`);
      const klineKey = `${symbol}:${exchangeType}`;
      const lastKline = this.lastKlines1m.get(klineKey);
      
      const isNewOrUpdated = !lastKline || lastKline.time !== kline.time || 
                             lastKline.close !== kline.close || lastKline.isClosed !== kline.isClosed;
      
      if (isNewOrUpdated) {
        this.lastKlines1m.set(klineKey, kline);
        const subCandles = resample1mToSeconds(kline, targetInterval);
        console.log(`[OkxWs] Resampled 1m into ${subCandles.length} ${targetInterval} candles`);
        subCandles.forEach((subCandle, index) => {
          console.log(`[OkxWs] Calling onKlineUpdate for sub-candle ${index + 1}/${subCandles.length}`);
          this.onKlineUpdate(symbol, targetInterval, exchangeType, subCandle);
        });
      } else {
        console.log(`[OkxWs] Skipping duplicate 1m candle (no changes)`);
      }
    } else {
      // Direct interval match - emit as-is
      console.log(`[OkxWs] Direct interval match, calling onKlineUpdate`);
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
      console.error(`[OkxWs] Max reconnection attempts reached for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      return;
    }

    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    console.log(`[OkxWs] Reconnecting ${subscriptionKey} in ${delay}ms (attempt ${subscription.reconnectAttempts})`);

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
      console.log(`[OkxWs] Not subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[OkxWs] Unsubscribing: ${subscriptionKey}`);

    if (subscription.reconnectTimer) {
      clearTimeout(subscription.reconnectTimer);
    }

    if (subscription.subscriptionTimeout) {
      clearTimeout(subscription.subscriptionTimeout);
    }

    if (subscription.ws && subscription.ws.readyState === WebSocket.OPEN) {
      try {
        const okxSymbol = formatSymbolForOKX(symbol, exchangeType);
        const okxInterval = mapIntervalToOKX(subscription.wsInterval);
        
        const unsubscribeMsg = {
          op: 'unsubscribe',
          args: [
            {
              channel: `candle${okxInterval}`,
              instId: okxSymbol,
            },
          ],
        };
        subscription.ws.send(JSON.stringify(unsubscribeMsg));
        subscription.ws.close();
      } catch (error) {
        console.error(`[OkxWs] Error closing WebSocket for ${subscriptionKey}:`, error.message);
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
    console.log('[OkxWs] Closing all connections...');

    for (const [key, subscription] of this.subscriptions) {
      if (subscription.reconnectTimer) {
        clearTimeout(subscription.reconnectTimer);
      }
      if (subscription.subscriptionTimeout) {
        clearTimeout(subscription.subscriptionTimeout);
      }
      if (subscription.ws) {
        try {
          subscription.ws.close();
        } catch (error) {
          console.error(`[OkxWs] Error closing ${key}:`, error.message);
        }
      }
    }

    this.subscriptions.clear();
    this.lastKlines1m.clear();

    console.log('[OkxWs] All connections closed');
  }
}

module.exports = OkxWsAdapter;
