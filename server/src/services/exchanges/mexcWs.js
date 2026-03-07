/**
 * MEXC WebSocket Adapter
 * Sub-minute (1s/5s/15s):
 *   - Futures: subscribes to sub.deal (trade stream) and aggregates via CandleAggregator
 *   - Spot: uses kline protobuf stream + Brownian-bridge resampling (no trade protobuf API)
 * Minute+: subscribes to kline channels as before
 */

const WebSocket = require('ws');
const protobuf = require('protobufjs');
const path = require('path');
const CandleAggregator = require('../../utils/CandleAggregator');
const { resample1mToSeconds } = require('../../utils/resampleKlines');

const FUTURES_WS_URL = 'wss://contract.mexc.com/edge';
const SPOT_WS_URL = 'wss://wbs-api.mexc.com/ws';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 15000;

// Load protobuf for spot
let SpotKlineMessage = null;
protobuf.load(path.join(__dirname, '../../proto/mexc-spot.proto'), (err, root) => {
  if (err) { console.error('[MexcWs] Failed to load protobuf:', err.message); return; }
  SpotKlineMessage = root.lookupType('PushDataV3ApiWrapper');
  console.log('[MexcWs] Protobuf loaded for spot klines');
});

function mapIntervalToMEXC(interval) {
  const map = { '1m': 'Min1', '5m': 'Min5', '15m': 'Min15', '30m': 'Min30', '1h': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
  return map[interval] || interval;
}

class MexcWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.aggregators = new Map();
    this.lastKlines1m = new Map(); // only for spot sub-minute fallback
    console.log('[MexcWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    let normalizedSymbol = symbol.toUpperCase();
    if (exchangeType === 'futures' && !normalizedSymbol.includes('_')) {
      normalizedSymbol = normalizedSymbol.replace('USDT', '_USDT');
    }
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    if (this.subscriptions.has(subscriptionKey)) return;
    console.log(`[MexcWs] Subscribing: ${subscriptionKey}`);

    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    if (isSubMinute && exchangeType === 'futures') {
      // Futures: use real trades via sub.deal
      this._connectFuturesTradeStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
    } else if (isSubMinute && exchangeType === 'spot') {
      // Spot: no trade protobuf API; use kline + Brownian-bridge resampling
      this._connectSpotKlineStream(normalizedSymbol, '1m', interval, exchangeType, subscriptionKey);
    } else {
      // Minute+ intervals: standard kline streams
      if (exchangeType === 'futures') {
        this._connectFuturesKlineStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
      } else {
        this._connectSpotKlineStream(normalizedSymbol, interval, interval, exchangeType, subscriptionKey);
      }
    }
  }

  // ---- Futures trade stream (sub-minute) ----
  _connectFuturesTradeStream(symbol, interval, exchangeType, subscriptionKey) {
    const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[interval];
    const aggregator = new CandleAggregator(spanSec);
    const originalSymbol = symbol.replace('_', '');
    aggregator.on('candle', (candle) => { this.onKlineUpdate(originalSymbol, interval, exchangeType, candle); });
    this.aggregators.set(subscriptionKey, aggregator);

    let ws;
    try { ws = new WebSocket(FUTURES_WS_URL); } catch (error) {
      console.error(`[MexcWs] Failed to create futures trade WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, 'futuresTrade');
      return;
    }
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, originalSymbol, targetInterval: interval, exchangeType, streamType: 'futuresTrade' };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      sub.reconnectAttempts = 0;
      ws.send(JSON.stringify({ method: 'sub.deal', param: { symbol } }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) { console.error(`[MexcWs] Futures trade sub timeout: ${subscriptionKey}`); ws.close(); } }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' })); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.channel === 'pong') return;
        if (message.channel === 'rs.sub.deal' || message.data === 'success') {
          sub.confirmed = true;
          if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; }
          return;
        }
        // Deal/trade data: { channel: "push.deal", data: { p: price, v: volume, T: 1 (buy)/2 (sell), O: 1 (open)/... , t: timestampMs }, symbol, ts }
        if (message.channel === 'push.deal' && message.data) {
          const trade = message.data;
          const price = parseFloat(trade.p);
          const qty = parseFloat(trade.v);
          const ts = parseInt(trade.t);
          if (price > 0 && qty > 0) {
            aggregator.addTrade({ price, quantity: qty, timestampMs: ts });
          }
        }
      } catch (err) { console.error(`[MexcWs] Futures trade parse error:`, err.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, 'futuresTrade');
    });
    ws.on('error', (error) => { console.error(`[MexcWs] Futures trade WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Futures kline stream (minute+) ----
  _connectFuturesKlineStream(symbol, interval, exchangeType, subscriptionKey) {
    const originalSymbol = symbol.replace('_', '');
    let ws;
    try { ws = new WebSocket(FUTURES_WS_URL); } catch (error) {
      console.error(`[MexcWs] Failed to create futures kline WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, 'futuresKline');
      return;
    }
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, originalSymbol, targetInterval: interval, exchangeType, streamType: 'futuresKline' };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      sub.reconnectAttempts = 0;
      const mexcInterval = mapIntervalToMEXC(interval);
      ws.send(JSON.stringify({ method: 'sub.kline', param: { symbol, interval: mexcInterval } }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) ws.close(); }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' })); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.channel === 'pong') return;
        if (message.channel === 'rs.sub.kline' || message.data === 'success' || message.code === 0) {
          sub.confirmed = true;
          if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; }
          return;
        }
        if (message.symbol && message.data && message.data.t) {
          const d = message.data;
          const kline = { time: Math.floor(d.t / 1000), open: parseFloat(d.o), high: parseFloat(d.h), low: parseFloat(d.l), close: parseFloat(d.c), volume: parseFloat(d.a || 0), isClosed: false };
          this.onKlineUpdate(originalSymbol, interval, exchangeType, kline);
        }
      } catch (error) { console.error(`[MexcWs] Futures kline parse error:`, error.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, 'futuresKline');
    });
    ws.on('error', (error) => { console.error(`[MexcWs] Futures kline WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Spot kline stream (minute+ direct, or 1m for sub-minute resampling) ----
  _connectSpotKlineStream(symbol, wsInterval, targetInterval, exchangeType, subscriptionKey) {
    const originalSymbol = symbol.replace('_', '');
    let ws;
    try { ws = new WebSocket(SPOT_WS_URL); } catch (error) {
      console.error(`[MexcWs] Failed to create spot WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, wsInterval, exchangeType, subscriptionKey, 0, 'spotKline');
      return;
    }
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, originalSymbol, wsInterval, targetInterval, exchangeType, streamType: 'spotKline' };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      sub.reconnectAttempts = 0;
      const mexcInterval = mapIntervalToMEXC(wsInterval);
      ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [`spot@public.kline.v3.api.pb@${symbol}@${mexcInterval}`] }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) ws.close(); }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' })); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      if (Buffer.isBuffer(data) && exchangeType === 'spot') {
        try {
          const message = JSON.parse(data.toString());
          if (message.code === 0 || message.msg) {
            sub.confirmed = true;
            if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; }
            return;
          }
        } catch (jsonError) {
          if (!SpotKlineMessage) return;
          try {
            const message = SpotKlineMessage.decode(data);
            const kd = message.publicSpotKline;
            if (kd) {
              const kline = {
                time: typeof kd.windowStart === 'number' ? kd.windowStart : parseInt(kd.windowStart),
                open: parseFloat(kd.openingPrice || 0),
                high: parseFloat(kd.highestPrice || 0),
                low: parseFloat(kd.lowestPrice || 0),
                close: parseFloat(kd.closingPrice || 0),
                volume: parseFloat(kd.volume || 0),
                isClosed: false,
              };
              this._handleSpotKline(kline, originalSymbol, targetInterval);
            }
          } catch (pbError) { console.error(`[MexcWs] Spot protobuf error:`, pbError.message); }
        }
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        if (message.channel === 'pong') return;
        if (message.code === 0 || message.msg === 'SUCCESS' || message.data === 'success') {
          sub.confirmed = true;
          if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; }
        }
      } catch (error) { /* binary protobuf handled above */ }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, wsInterval, exchangeType, subscriptionKey, sub.reconnectAttempts, 'spotKline');
    });
    ws.on('error', (error) => { console.error(`[MexcWs] Spot WS error: ${subscriptionKey}:`, error.message); });
  }

  _handleSpotKline(kline, symbol, targetInterval) {
    if (['1s', '5s', '15s'].includes(targetInterval)) {
      const klineKey = `${symbol}:spot`;
      const lastKline = this.lastKlines1m.get(klineKey);
      const isNew = !lastKline || lastKline.time !== kline.time || lastKline.close !== kline.close;
      if (isNew) {
        this.lastKlines1m.set(klineKey, { ...kline });
        const subCandles = resample1mToSeconds(kline, targetInterval);
        for (const sub of subCandles) {
          this.onKlineUpdate(symbol, targetInterval, 'spot', sub);
        }
      }
    } else {
      this.onKlineUpdate(symbol, targetInterval, 'spot', kline);
    }
  }

  // ---- Reconnection ----
  _scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, attempts, streamType) {
    if (!this.subscriptions.has(subscriptionKey)) return;
    const sub = this.subscriptions.get(subscriptionKey);
    sub.reconnectAttempts = attempts + 1;
    if (sub.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[MexcWs] Max reconnect attempts for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      const agg = this.aggregators.get(subscriptionKey); if (agg) { agg.reset(); this.aggregators.delete(subscriptionKey); }
      return;
    }
    const delay = RECONNECT_DELAY_MS * Math.min(sub.reconnectAttempts, 5);
    sub.reconnectTimer = setTimeout(() => {
      if (!this.subscriptions.has(subscriptionKey)) return;
      this.subscriptions.delete(subscriptionKey);
      if (streamType === 'futuresTrade') this._connectFuturesTradeStream(symbol, interval, exchangeType, subscriptionKey);
      else if (streamType === 'futuresKline') this._connectFuturesKlineStream(symbol, interval, exchangeType, subscriptionKey);
      else this._connectSpotKlineStream(symbol, sub.wsInterval || interval, sub.targetInterval || interval, exchangeType, subscriptionKey);
    }, delay);
  }

  unsubscribe(symbol, interval, exchangeType) {
    let normalizedSymbol = symbol.toUpperCase();
    if (exchangeType === 'futures' && !normalizedSymbol.includes('_')) {
      normalizedSymbol = normalizedSymbol.replace('USDT', '_USDT');
    }
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    const sub = this.subscriptions.get(subscriptionKey);
    if (!sub) return;
    if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
    if (sub.pingTimer) clearInterval(sub.pingTimer);
    if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
    if (sub.ws) { try { sub.ws.close(); } catch (e) { /* ignore */ } }
    this.subscriptions.delete(subscriptionKey);
    const agg = this.aggregators.get(subscriptionKey);
    if (agg) { agg.flush(); agg.reset(); this.aggregators.delete(subscriptionKey); }
    const klineKey = `${normalizedSymbol}:${exchangeType}`;
    this.lastKlines1m.delete(klineKey);
  }

  close() {
    console.log('[MexcWs] Closing all connections...');
    for (const [, sub] of this.subscriptions) {
      if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (sub.ws) { try { sub.ws.close(); } catch (e) { /* ignore */ } }
    }
    for (const [, agg] of this.aggregators) { agg.reset(); }
    this.subscriptions.clear();
    this.aggregators.clear();
    this.lastKlines1m.clear();
    console.log('[MexcWs] All connections closed');
  }
}

module.exports = MexcWsAdapter;
