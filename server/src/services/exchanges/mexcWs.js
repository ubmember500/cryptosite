/**
 * MEXC WebSocket Adapter
 * Handles WebSocket connections to MEXC for real-time kline data
 */

const WebSocket = require('ws');
const protobuf = require('protobufjs');
const path = require('path');

// WebSocket URLs
const FUTURES_WS_URL = 'wss://contract.mexc.com/edge';
const SPOT_WS_URL = 'wss://wbs-api.mexc.com/ws'; // New API (old one deprecated Aug 2025)

// Load protobuf for spot
let SpotKlineMessage = null;
protobuf.load(path.join(__dirname, '../../proto/mexc-spot.proto'), (err, root) => {
  if (err) {
    console.error('[MexcWs] Failed to load protobuf:', err.message);
    return;
  }
  SpotKlineMessage = root.lookupType('PushDataV3ApiWrapper');
  console.log('[MexcWs] Protobuf loaded for spot klines');
});

// Reconnection settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 15000; // MEXC requires ping every 15-20 seconds

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
 * Map interval to MEXC format
 */
function mapIntervalToMEXC(interval) {
  const map = {
    '1m': 'Min1',
    '5m': 'Min5',
    '15m': 'Min15',
    '30m': 'Min30',
    '1h': 'Min60',
    '4h': 'Hour4',
    '1d': 'Day1',
  };
  return map[interval] || interval;
}

class MexcWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.lastKlines1m = new Map();
    
    console.log('[MexcWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    // Normalize symbol to uppercase
    let normalizedSymbol = symbol.toUpperCase();
    
    // MEXC futures requires underscore format: BTC_USDT instead of BTCUSDT
    if (exchangeType === 'futures' && !normalizedSymbol.includes('_')) {
      normalizedSymbol = normalizedSymbol.replace('USDT', '_USDT');
    }
    
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    
    if (this.subscriptions.has(subscriptionKey)) {
      console.log(`[MexcWs] Already subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[MexcWs] Subscribing: ${subscriptionKey} (normalized from ${symbol})`);
    
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    const wsInterval = isSubMinute ? '1m' : interval;
    
    this.connectStream(normalizedSymbol, wsInterval, interval, exchangeType, subscriptionKey);
  }

  connectStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;

    // Store the original symbol (without underscore) for emitting back to frontend
    const originalSymbol = symbol.replace('_', '');

    let ws;
    try {
      ws = new WebSocket(baseUrl);
    } catch (error) {
      console.error(`[MexcWs] Failed to create WebSocket for ${subscriptionKey}:`, error.message);
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
      symbol, // MEXC format (with underscore for futures)
      originalSymbol, // Frontend format (without underscore)
      wsInterval,
      targetInterval,
      exchangeType,
    };

    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => {
      console.log(`[MexcWs] Connected: ${subscriptionKey}`);
      subscription.reconnectAttempts = 0;

      // Subscribe to kline stream
      if (exchangeType === 'futures') {
        // Futures format
        const mexcInterval = mapIntervalToMEXC(wsInterval);
        const subscribeMsg = {
          method: 'sub.kline',
          param: {
            symbol,
            interval: mexcInterval,
          },
        };
        console.log(`[MexcWs] Subscribing to futures: symbol=${symbol}, interval=${mexcInterval}`);
        ws.send(JSON.stringify(subscribeMsg));
      } else {
        // Spot format - NEW API with protobuf (.pb suffix)
        const mexcInterval = mapIntervalToMEXC(wsInterval);
        const subscribeMsg = {
          method: 'SUBSCRIPTION',
          params: [`spot@public.kline.v3.api.pb@${symbol}@${mexcInterval}`],
        };
        console.log(`[MexcWs] Subscribing to spot (protobuf): ${symbol}@${mexcInterval}`);
        ws.send(JSON.stringify(subscribeMsg));
      }

      // Set timeout to detect failed subscription
      subscription.subscriptionTimeout = setTimeout(() => {
        if (!subscription.confirmed) {
          console.error(`[MexcWs] ⏱️ Subscription timeout for ${subscriptionKey} - no confirmation received in 10s`);
          // Trigger reconnection
          ws.close();
        }
      }, 10000); // 10 second timeout

      // Start ping timer
      subscription.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: 'ping' }));
          console.log(`[MexcWs] Ping sent for ${subscriptionKey}`);
        } else {
          console.warn(`[MexcWs] Cannot ping, socket not open: ${subscriptionKey}, state: ${ws.readyState}`);
        }
      }, PING_INTERVAL_MS);
      console.log(`[MexcWs] Ping timer started (interval: ${PING_INTERVAL_MS}ms)`);
    });

    ws.on('message', (data) => {
      // Check if data is binary (protobuf) - used by new spot API
      if (Buffer.isBuffer(data) && exchangeType === 'spot') {
        // Try to decode as JSON first (subscription confirmations are still JSON)
        try {
          const message = JSON.parse(data.toString());
          
          // Handle subscription confirmation
          if (message.code === 0 || message.msg) {
            console.log(`[MexcWs] ✓ Spot subscription confirmed: ${subscriptionKey}`);
            subscription.confirmed = true;
            if (subscription.subscriptionTimeout) {
              clearTimeout(subscription.subscriptionTimeout);
              subscription.subscriptionTimeout = null;
            }
            return;
          }
        } catch (jsonError) {
          // Not JSON, must be protobuf binary data
          if (!SpotKlineMessage) {
            console.error(`[MexcWs] Protobuf not loaded yet, cannot parse spot data`);
            return;
          }
          
          try {
            const message = SpotKlineMessage.decode(data);
            const klineData = message.publicSpotKline; // Fixed: use camelCase
            
            if (klineData) {
              console.log(`[MexcWs] Parsed spot protobuf kline: ${subscription.originalSymbol} ${targetInterval} C:${klineData.closingPrice}`);
              this.handleSpotProtobufMessage(klineData, subscription.originalSymbol, targetInterval);
            }
          } catch (pbError) {
            console.error(`[MexcWs] Failed to parse protobuf for ${subscriptionKey}:`, pbError.message);
          }
        }
        return;
      }
      
      // JSON parsing (for futures or text messages)
      try {
        const message = JSON.parse(data.toString());
        
        // Handle ping/pong
        if (message.channel === 'pong') {
          console.log(`[MexcWs] Pong received for ${subscriptionKey}`);
          return;
        }
        
        // Handle subscription confirmation
        if (message.code === 0 || message.msg === 'SUCCESS' || message.channel === 'rs.sub.kline' || message.data === 'success') {
          console.log(`[MexcWs] ✓ Subscription confirmed: ${subscriptionKey}`);
          subscription.confirmed = true;
          if (subscription.subscriptionTimeout) {
            clearTimeout(subscription.subscriptionTimeout);
            subscription.subscriptionTimeout = null;
          }
          return;
        }
        
        // Handle subscription error
        if (message.code && message.code !== 0) {
          console.error(`[MexcWs] ✗ Subscription error: ${subscriptionKey}`, message);
          return;
        }
        
        // Handle kline data (futures)
        if (message.symbol && message.data) {
          // Futures format: { symbol: "BTC_USDT", data: { symbol, interval, t, o, h, l, c, a, q, ... } }
          this.handleMessage(message, subscription.originalSymbol, targetInterval, exchangeType);
        } else {
          // Log unexpected message format occasionally
          if (Math.random() < 0.05) {
            console.log(`[MexcWs] Other message:`, Object.keys(message), JSON.stringify(message).substring(0, 150));
          }
        }
      } catch (error) {
        console.error(`[MexcWs] Error parsing message for ${subscriptionKey}:`, error.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.warn(`[MexcWs] Connection closed: ${subscriptionKey} (code: ${code})`);
      
      // Clear timers
      if (subscription.pingTimer) {
        clearInterval(subscription.pingTimer);
        subscription.pingTimer = null;
      }
      if (subscription.subscriptionTimeout) {
        clearTimeout(subscription.subscriptionTimeout);
        subscription.subscriptionTimeout = null;
      }
      
      if (this.subscriptions.has(subscriptionKey)) {
        this.scheduleReconnect(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey, subscription.reconnectAttempts);
      }
    });

    ws.on('error', (error) => {
      console.error(`[MexcWs] WebSocket error for ${subscriptionKey}:`, error.message);
    });
  }

  handleSpotProtobufMessage(klineData, symbol, targetInterval) {
    // Parse protobuf kline data from MEXC spot API
    // Data structure: { interval, windowStart, openingPrice, closingPrice, highestPrice, lowestPrice, volume, amount, windowEnd }
    
    const kline = {
      time: typeof klineData.windowStart === 'number' ? klineData.windowStart : parseInt(klineData.windowStart),
      open: parseFloat(klineData.openingPrice || 0),
      high: parseFloat(klineData.highestPrice || 0),
      low: parseFloat(klineData.lowestPrice || 0),
      close: parseFloat(klineData.closingPrice || 0),
      volume: parseFloat(klineData.volume || 0),
      isClosed: false, // Protobuf stream doesn't have explicit closed flag
    };
    
    console.log(`[MexcWs] Emitting spot protobuf kline: ${symbol} ${targetInterval} @ ${kline.time} C:${kline.close}`);
    this.emitKline(symbol, targetInterval, 'spot', kline);
  }

  handleMessage(message, symbol, targetInterval, exchangeType) {
    let candleData;
    
    if (exchangeType === 'futures') {
      // Futures format: { symbol: "BTC_USDT", data: { symbol, interval, t, o, h, l, c, a, q, ... } }
      if (!message.data || !message.data.t) {
        console.warn(`[MexcWs] Invalid futures data format:`, Object.keys(message.data || {}));
        return;
      }
      
      candleData = message.data;
      
      // Data validation
      const hasSymbol = !!candleData.symbol;
      const hasInterval = !!candleData.interval;
      const hasTime = typeof candleData.t === 'number';
      const hasOHLC = candleData.o !== undefined && candleData.h !== undefined && 
                      candleData.l !== undefined && candleData.c !== undefined;
      
      if (!hasSymbol || !hasInterval || !hasTime || !hasOHLC) {
        console.warn(`[MexcWs] Missing required fields in futures kline data:`, {
          hasSymbol, hasInterval, hasTime, hasOHLC, data: candleData
        });
        return;
      }
      
      const kline = {
        time: Math.floor(candleData.t / 1000), // Convert ms to seconds
        open: parseFloat(candleData.o),
        high: parseFloat(candleData.h),
        low: parseFloat(candleData.l),
        close: parseFloat(candleData.c),
        volume: parseFloat(candleData.a || 0), // 'a' is volume in MEXC futures
        isClosed: false, // MEXC futures doesn't have a closed flag for streaming updates
      };
      
      console.log(`[MexcWs] Parsed futures kline: ${symbol} ${targetInterval} @ ${kline.time} C:${kline.close}`);
      this.emitKline(symbol, targetInterval, exchangeType, kline);
    } else {
      // Spot now uses protobuf format, handled in handleSpotProtobufMessage
      console.warn(`[MexcWs] Spot JSON format received (unexpected, should be protobuf)`, Object.keys(message));
    }
  }

  emitKline(symbol, targetInterval, exchangeType, kline) {
    // Log occasionally for debugging
    if (Math.random() < 0.01) {
      console.log('[MexcWs] Kline data received:', {
        symbol,
        time: kline.time,
        close: kline.close,
        isClosed: kline.isClosed,
      });
    }
    
    // Handle sub-minute intervals
    if (['1s', '5s', '15s'].includes(targetInterval)) {
      const klineKey = `${symbol}:${exchangeType}`;
      const lastKline = this.lastKlines1m.get(klineKey);
      
      const isNewOrUpdated = !lastKline || lastKline.time !== kline.time || 
                             lastKline.close !== kline.close || lastKline.isClosed !== kline.isClosed;
      
      if (isNewOrUpdated) {
        this.lastKlines1m.set(klineKey, { ...kline });
        const subCandles = resample1mToSeconds(kline, targetInterval);
        subCandles.forEach((subCandle) => {
          this.onKlineUpdate(symbol, targetInterval, exchangeType, subCandle);
        });
      }
    } else {
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
      console.error(`[MexcWs] Max reconnection attempts reached for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      return;
    }

    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    console.log(`[MexcWs] Reconnecting ${subscriptionKey} in ${delay}ms (attempt ${subscription.reconnectAttempts})`);

    subscription.reconnectTimer = setTimeout(() => {
      if (this.subscriptions.has(subscriptionKey)) {
        this.connectStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey);
      }
    }, delay);
  }

  unsubscribe(symbol, interval, exchangeType) {
    // Normalize symbol to uppercase
    let normalizedSymbol = symbol.toUpperCase();
    
    // MEXC futures requires underscore format: BTC_USDT instead of BTCUSDT
    if (exchangeType === 'futures' && !normalizedSymbol.includes('_')) {
      normalizedSymbol = normalizedSymbol.replace('USDT', '_USDT');
    }
    
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) {
      console.log(`[MexcWs] Not subscribed: ${subscriptionKey}`);
      return;
    }

    console.log(`[MexcWs] Unsubscribing: ${subscriptionKey}`);

    // Clear all timers
    if (subscription.reconnectTimer) {
      clearTimeout(subscription.reconnectTimer);
      subscription.reconnectTimer = null;
    }
    if (subscription.pingTimer) {
      clearInterval(subscription.pingTimer);
      subscription.pingTimer = null;
    }
    if (subscription.subscriptionTimeout) {
      clearTimeout(subscription.subscriptionTimeout);
      subscription.subscriptionTimeout = null;
    }

    if (subscription.ws && subscription.ws.readyState === WebSocket.OPEN) {
      try {
        if (exchangeType === 'futures') {
          const mexcInterval = mapIntervalToMEXC(subscription.wsInterval);
          const unsubscribeMsg = {
            method: 'unsub.kline',
            param: {
              symbol: normalizedSymbol,
              interval: mexcInterval,
            },
          };
          subscription.ws.send(JSON.stringify(unsubscribeMsg));
        } else {
          const mexcInterval = subscription.wsInterval.toUpperCase();
          const unsubscribeMsg = {
            method: 'UNSUBSCRIPTION',
            params: [`spot@public.kline.v3.api@${normalizedSymbol}@${mexcInterval}`],
          };
          subscription.ws.send(JSON.stringify(unsubscribeMsg));
        }
        subscription.ws.close();
      } catch (error) {
        console.error(`[MexcWs] Error closing WebSocket for ${subscriptionKey}:`, error.message);
      }
    }

    this.subscriptions.delete(subscriptionKey);

    const klineKey = `${normalizedSymbol}:${exchangeType}`;
    const hasSubMinuteSubs = Array.from(this.subscriptions.keys()).some((key) => {
      const [s, i, e] = key.split(':');
      return s === normalizedSymbol && e === exchangeType && ['1s', '5s', '15s'].includes(i);
    });
    if (!hasSubMinuteSubs) {
      this.lastKlines1m.delete(klineKey);
    }
  }

  close() {
    console.log('[MexcWs] Closing all connections...');

    for (const [key, subscription] of this.subscriptions) {
      // Clear all timers
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
          console.error(`[MexcWs] Error closing ${key}:`, error.message);
        }
      }
    }

    this.subscriptions.clear();
    this.lastKlines1m.clear();

    console.log('[MexcWs] All connections closed');
  }
}

module.exports = MexcWsAdapter;
