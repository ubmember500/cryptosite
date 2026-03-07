/**
 * Binance WebSocket Adapter
 * Handles WebSocket connections to Binance for real-time kline data.
 *
 * For sub-minute intervals (1s, 5s, 15s) subscribes to the aggTrade stream
 * and aggregates real trades into OHLCV candles via CandleAggregator.
 * For minute+ intervals, subscribes to native kline streams as before.
 */

const WebSocket = require('ws');
const CandleAggregator = require('../../utils/CandleAggregator');

// WebSocket URLs
const FUTURES_WS_URL = 'wss://fstream.binance.com/ws';
const SPOT_WS_URL = 'wss://stream.binance.com:9443/ws';

// Reconnection settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

class BinanceWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.aggregators = new Map();
    console.log('[BinanceWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    const subscriptionKey = `${symbol}:${interval}:${exchangeType}`;
    if (this.subscriptions.has(subscriptionKey)) {
      console.log(`[BinanceWs] Already subscribed: ${subscriptionKey}`);
      return;
    }
    console.log(`[BinanceWs] Subscribing: ${subscriptionKey}`);
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    if (isSubMinute) {
      this._connectTradeStream(symbol, interval, exchangeType, subscriptionKey);
    } else {
      this._connectKlineStream(symbol, interval, exchangeType, subscriptionKey);
    }
  }

  // ---- Trade stream (sub-minute) ----
  _connectTradeStream(symbol, interval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;
    const streamName = `${symbol.toLowerCase()}@aggTrade`;
    const url = `${baseUrl}/${streamName}`;
    const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[interval];
    const aggregator = new CandleAggregator(spanSec);
    aggregator.on('candle', (candle) => {
      this.onKlineUpdate(symbol, interval, exchangeType, candle);
    });
    this.aggregators.set(subscriptionKey, aggregator);

    let ws;
    try { ws = new WebSocket(url); } catch (error) {
      console.error(`[BinanceWs] Failed to create trade WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, true);
      return;
    }
    const subscription = { ws, reconnectAttempts: 0, reconnectTimer: null, symbol, targetInterval: interval, exchangeType, isTrade: true };
    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => { console.log(`[BinanceWs] Trade stream connected: ${subscriptionKey}`); subscription.reconnectAttempts = 0; });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.e === 'aggTrade') {
          aggregator.addTrade({ price: parseFloat(msg.p), quantity: parseFloat(msg.q), timestampMs: msg.T });
        }
      } catch (err) { console.error(`[BinanceWs] Trade parse error:`, err.message); }
    });
    ws.on('close', (code) => {
      console.warn(`[BinanceWs] Trade stream closed: ${subscriptionKey} (code: ${code})`);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, subscription.reconnectAttempts, true);
    });
    ws.on('error', (error) => { console.error(`[BinanceWs] Trade WS error for ${subscriptionKey}:`, error.message); });
  }

  // ---- Kline stream (minute+) ----
  _connectKlineStream(symbol, interval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    const url = `${baseUrl}/${streamName}`;

    let ws;
    try { ws = new WebSocket(url); } catch (error) {
      console.error(`[BinanceWs] Failed to create kline WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, false);
      return;
    }
    const subscription = { ws, reconnectAttempts: 0, reconnectTimer: null, symbol, targetInterval: interval, exchangeType, isTrade: false };
    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => { console.log(`[BinanceWs] Kline stream connected: ${subscriptionKey}`); subscription.reconnectAttempts = 0; });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const k = message.k;
        if (!k) return;
        const kline = { time: Math.floor(k.t / 1000), open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v), isClosed: k.x };
        this.onKlineUpdate(k.s, interval, exchangeType, kline);
      } catch (error) { console.error(`[BinanceWs] Kline parse error:`, error.message); }
    });
    ws.on('close', (code) => {
      console.warn(`[BinanceWs] Kline stream closed: ${subscriptionKey} (code: ${code})`);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, subscription.reconnectAttempts, false);
    });
    ws.on('error', (error) => { console.error(`[BinanceWs] Kline WS error for ${subscriptionKey}:`, error.message); });
  }

  // ---- Reconnection ----
  _scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, attempts, isTrade) {
    if (!this.subscriptions.has(subscriptionKey)) return;
    const subscription = this.subscriptions.get(subscriptionKey);
    subscription.reconnectAttempts = attempts + 1;
    if (subscription.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[BinanceWs] Max reconnection attempts reached for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      const agg = this.aggregators.get(subscriptionKey);
      if (agg) { agg.reset(); this.aggregators.delete(subscriptionKey); }
      return;
    }
    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    console.log(`[BinanceWs] Reconnecting ${subscriptionKey} in ${delay}ms (attempt ${subscription.reconnectAttempts})`);
    subscription.reconnectTimer = setTimeout(() => {
      if (!this.subscriptions.has(subscriptionKey)) return;
      this.subscriptions.delete(subscriptionKey);
      if (isTrade) this._connectTradeStream(symbol, interval, exchangeType, subscriptionKey);
      else this._connectKlineStream(symbol, interval, exchangeType, subscriptionKey);
    }, delay);
  }

  // ---- Unsubscribe / close ----
  unsubscribe(symbol, interval, exchangeType) {
    const subscriptionKey = `${symbol}:${interval}:${exchangeType}`;
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) { console.log(`[BinanceWs] Not subscribed: ${subscriptionKey}`); return; }
    console.log(`[BinanceWs] Unsubscribing: ${subscriptionKey}`);
    if (subscription.reconnectTimer) clearTimeout(subscription.reconnectTimer);
    if (subscription.ws) { try { subscription.ws.close(); } catch (e) { /* ignore */ } }
    this.subscriptions.delete(subscriptionKey);
    const agg = this.aggregators.get(subscriptionKey);
    if (agg) { agg.flush(); agg.reset(); this.aggregators.delete(subscriptionKey); }
  }

  close() {
    console.log('[BinanceWs] Closing all connections...');
    for (const [, subscription] of this.subscriptions) {
      if (subscription.reconnectTimer) clearTimeout(subscription.reconnectTimer);
      if (subscription.ws) { try { subscription.ws.close(); } catch (e) { /* ignore */ } }
    }
    for (const [, agg] of this.aggregators) { agg.reset(); }
    this.subscriptions.clear();
    this.aggregators.clear();
    console.log('[BinanceWs] All connections closed');
  }
}

module.exports = BinanceWsAdapter;
