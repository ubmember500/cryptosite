/**
 * Bybit WebSocket Adapter
 * For sub-minute intervals (1s, 5s, 15s) subscribes to publicTrade stream
 * and aggregates real trades into OHLCV candles via CandleAggregator.
 */

const WebSocket = require('ws');
const CandleAggregator = require('../../utils/CandleAggregator');

const FUTURES_WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const SPOT_WS_URL = 'wss://stream.bybit.com/v5/public/spot';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 20000;

function mapIntervalToBybit(interval) {
  const map = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };
  return map[interval] || '1';
}

class BybitWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.aggregators = new Map();
    console.log('[BybitWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    if (this.subscriptions.has(subscriptionKey)) { console.log(`[BybitWs] Already subscribed: ${subscriptionKey}`); return; }
    console.log(`[BybitWs] Subscribing: ${subscriptionKey}`);
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    if (isSubMinute) {
      this._connectTradeStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
    } else {
      this._connectKlineStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
    }
  }

  // ---- Trade stream (sub-minute) ----
  _connectTradeStream(symbol, interval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;
    const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[interval];
    const aggregator = new CandleAggregator(spanSec);
    aggregator.on('candle', (candle) => { this.onKlineUpdate(symbol, interval, exchangeType, candle); });
    this.aggregators.set(subscriptionKey, aggregator);

    let ws;
    try { ws = new WebSocket(baseUrl); } catch (error) {
      console.error(`[BybitWs] Failed to create trade WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, true);
      return;
    }
    const subscription = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, targetInterval: interval, exchangeType, isTrade: true };
    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => {
      console.log(`[BybitWs] Trade stream connected: ${subscriptionKey}`);
      subscription.reconnectAttempts = 0;
      ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${symbol}`] }));
      subscription.subscriptionTimeout = setTimeout(() => { if (!subscription.confirmed) { console.error(`[BybitWs] Trade sub timeout: ${subscriptionKey}`); ws.close(); } }, 10000);
      subscription.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' })); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.op === 'pong') return;
        if (message.op === 'subscribe') {
          if (message.success) { subscription.confirmed = true; if (subscription.subscriptionTimeout) { clearTimeout(subscription.subscriptionTimeout); subscription.subscriptionTimeout = null; } }
          return;
        }
        if (message.topic && message.topic.startsWith('publicTrade.') && message.data) {
          for (const trade of message.data) {
            aggregator.addTrade({ price: parseFloat(trade.p), quantity: parseFloat(trade.v), timestampMs: parseInt(trade.T) });
          }
        }
      } catch (err) { console.error(`[BybitWs] Trade parse error:`, err.message); }
    });
    ws.on('close', (code) => {
      console.warn(`[BybitWs] Trade stream closed: ${subscriptionKey} (code: ${code})`);
      if (subscription.pingTimer) clearInterval(subscription.pingTimer);
      if (subscription.subscriptionTimeout) clearTimeout(subscription.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, subscription.reconnectAttempts, true);
    });
    ws.on('error', (error) => { console.error(`[BybitWs] Trade WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Kline stream (minute+) ----
  _connectKlineStream(symbol, interval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;
    let ws;
    try { ws = new WebSocket(baseUrl); } catch (error) {
      console.error(`[BybitWs] Failed to create kline WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, false);
      return;
    }
    const subscription = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, wsInterval: interval, targetInterval: interval, exchangeType, isTrade: false };
    this.subscriptions.set(subscriptionKey, subscription);

    ws.on('open', () => {
      subscription.reconnectAttempts = 0;
      const bybitInterval = mapIntervalToBybit(interval);
      ws.send(JSON.stringify({ op: 'subscribe', args: [`kline.${bybitInterval}.${symbol}`] }));
      subscription.subscriptionTimeout = setTimeout(() => { if (!subscription.confirmed) ws.close(); }, 10000);
      subscription.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' })); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.op === 'pong') return;
        if (message.op === 'subscribe') { if (message.success) { subscription.confirmed = true; if (subscription.subscriptionTimeout) { clearTimeout(subscription.subscriptionTimeout); subscription.subscriptionTimeout = null; } } return; }
        if (message.topic && message.topic.startsWith('kline.') && message.data && message.data.length > 0) {
          const k = message.data[0];
          const kline = { time: Math.floor(k.start / 1000), open: parseFloat(k.open), high: parseFloat(k.high), low: parseFloat(k.low), close: parseFloat(k.close), volume: parseFloat(k.volume), isClosed: k.confirm === true };
          this.onKlineUpdate(symbol, interval, exchangeType, kline);
        }
      } catch (error) { console.error(`[BybitWs] Kline parse error:`, error.message); }
    });
    ws.on('close', (code) => {
      if (subscription.pingTimer) clearInterval(subscription.pingTimer);
      if (subscription.subscriptionTimeout) clearTimeout(subscription.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, subscription.reconnectAttempts, false);
    });
    ws.on('error', (error) => { console.error(`[BybitWs] Kline WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Reconnection ----
  _scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, attempts, isTrade) {
    if (!this.subscriptions.has(subscriptionKey)) return;
    const subscription = this.subscriptions.get(subscriptionKey);
    subscription.reconnectAttempts = attempts + 1;
    if (subscription.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[BybitWs] Max reconnect attempts for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      const agg = this.aggregators.get(subscriptionKey); if (agg) { agg.reset(); this.aggregators.delete(subscriptionKey); }
      return;
    }
    const delay = RECONNECT_DELAY_MS * Math.min(subscription.reconnectAttempts, 5);
    subscription.reconnectTimer = setTimeout(() => {
      if (!this.subscriptions.has(subscriptionKey)) return;
      this.subscriptions.delete(subscriptionKey);
      if (isTrade) this._connectTradeStream(symbol, interval, exchangeType, subscriptionKey);
      else this._connectKlineStream(symbol, interval, exchangeType, subscriptionKey);
    }, delay);
  }

  unsubscribe(symbol, interval, exchangeType) {
    const subscriptionKey = `${symbol}:${interval}:${exchangeType}`;
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    if (subscription.reconnectTimer) clearTimeout(subscription.reconnectTimer);
    if (subscription.pingTimer) clearInterval(subscription.pingTimer);
    if (subscription.subscriptionTimeout) clearTimeout(subscription.subscriptionTimeout);
    if (subscription.ws) { try { subscription.ws.close(); } catch (e) { /* ignore */ } }
    this.subscriptions.delete(subscriptionKey);
    const agg = this.aggregators.get(subscriptionKey);
    if (agg) { agg.flush(); agg.reset(); this.aggregators.delete(subscriptionKey); }
  }

  close() {
    console.log('[BybitWs] Closing all connections...');
    for (const [, sub] of this.subscriptions) {
      if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (sub.ws) { try { sub.ws.close(); } catch (e) { /* ignore */ } }
    }
    for (const [, agg] of this.aggregators) { agg.reset(); }
    this.subscriptions.clear();
    this.aggregators.clear();
    console.log('[BybitWs] All connections closed');
  }
}

module.exports = BybitWsAdapter;
