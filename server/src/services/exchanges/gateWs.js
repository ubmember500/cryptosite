/**
 * Gate.io WebSocket Adapter
 * Sub-minute (1s/5s/15s): subscribes to trades stream and aggregates via CandleAggregator
 * Minute+: subscribes to candlesticks channel (as before)
 */

const WebSocket = require('ws');
const CandleAggregator = require('../../utils/CandleAggregator');

const FUTURES_WS_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
const SPOT_WS_URL = 'wss://api.gateio.ws/ws/v4/';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 15000;

function mapIntervalToGate(interval) {
  const map = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' };
  return map[interval] || interval;
}

function formatSymbolForGate(symbol) {
  return symbol.replace('USDT', '_USDT');
}

class GateWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.aggregators = new Map();
    console.log('[GateWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    if (this.subscriptions.has(subscriptionKey)) return;
    console.log(`[GateWs] Subscribing: ${subscriptionKey}`);
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
    const gateSymbol = formatSymbolForGate(symbol);
    const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[interval];
    const aggregator = new CandleAggregator(spanSec);
    aggregator.on('candle', (candle) => { this.onKlineUpdate(symbol, interval, exchangeType, candle); });
    this.aggregators.set(subscriptionKey, aggregator);

    let ws;
    try { ws = new WebSocket(baseUrl); } catch (error) {
      console.error(`[GateWs] Failed to create trade WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, true);
      return;
    }
    const channel = exchangeType === 'futures' ? 'futures.trades' : 'spot.trades';
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, targetInterval: interval, exchangeType, isTrade: true, channel };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      console.log(`[GateWs] Trade stream connected: ${subscriptionKey}`);
      sub.reconnectAttempts = 0;
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel, event: 'subscribe', payload: [gateSymbol] }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) { console.error(`[GateWs] Trade sub timeout: ${subscriptionKey}`); ws.close(); } }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ channel, event: 'ping' })); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.event === 'pong') return;
        if (message.event === 'subscribe') {
          sub.confirmed = true;
          if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; }
          return;
        }
        if (message.event === 'error') { console.error(`[GateWs] Trade error:`, message); return; }
        if (message.event === 'update' && message.result) {
          const trades = Array.isArray(message.result) ? message.result : [message.result];
          for (const trade of trades) {
            const price = parseFloat(trade.price);
            const qty = parseFloat(trade.size || trade.amount || 0);
            const ts = exchangeType === 'futures'
              ? Math.floor(parseFloat(trade.create_time) * 1000)
              : Math.floor(parseFloat(trade.create_time) * 1000);
            if (price > 0 && qty > 0) {
              aggregator.addTrade({ price, quantity: qty, timestampMs: ts });
            }
          }
        }
      } catch (err) { console.error(`[GateWs] Trade parse error:`, err.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, true);
    });
    ws.on('error', (error) => { console.error(`[GateWs] Trade WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Kline stream (minute+) ----
  _connectKlineStream(symbol, interval, exchangeType, subscriptionKey) {
    const baseUrl = exchangeType === 'futures' ? FUTURES_WS_URL : SPOT_WS_URL;
    const gateSymbol = formatSymbolForGate(symbol);
    let ws;
    try { ws = new WebSocket(baseUrl); } catch (error) {
      console.error(`[GateWs] Failed to create kline WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, false);
      return;
    }
    const channel = exchangeType === 'futures' ? 'futures.candlesticks' : 'spot.candlesticks';
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, targetInterval: interval, exchangeType, isTrade: false, channel };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      sub.reconnectAttempts = 0;
      const gateInterval = mapIntervalToGate(interval);
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel, event: 'subscribe', payload: [gateInterval, gateSymbol] }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) ws.close(); }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ channel, event: 'ping' })); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.event === 'pong') return;
        if (message.event === 'subscribe') { sub.confirmed = true; if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; } return; }
        if (message.event === 'error') { console.error(`[GateWs] Kline error:`, message); return; }
        if (message.event === 'update' && message.result) {
          const candleData = Array.isArray(message.result) ? message.result[0] : message.result;
          if (!candleData || !candleData.t) return;
          const kline = {
            time: parseInt(candleData.t),
            open: parseFloat(candleData.o),
            high: parseFloat(candleData.h),
            low: parseFloat(candleData.l),
            close: parseFloat(candleData.c),
            volume: parseFloat(candleData.v || candleData.a || 0),
            turnover: parseFloat(candleData.a || 0),
            isClosed: candleData.w === true,
          };
          this.onKlineUpdate(symbol, interval, exchangeType, kline);
        }
      } catch (error) { console.error(`[GateWs] Kline parse error:`, error.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, false);
    });
    ws.on('error', (error) => { console.error(`[GateWs] Kline WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Reconnection ----
  _scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, attempts, isTrade) {
    if (!this.subscriptions.has(subscriptionKey)) return;
    const sub = this.subscriptions.get(subscriptionKey);
    sub.reconnectAttempts = attempts + 1;
    if (sub.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[GateWs] Max reconnect attempts for ${subscriptionKey}`);
      this.subscriptions.delete(subscriptionKey);
      const agg = this.aggregators.get(subscriptionKey); if (agg) { agg.reset(); this.aggregators.delete(subscriptionKey); }
      return;
    }
    const delay = RECONNECT_DELAY_MS * Math.min(sub.reconnectAttempts, 5);
    sub.reconnectTimer = setTimeout(() => {
      if (!this.subscriptions.has(subscriptionKey)) return;
      this.subscriptions.delete(subscriptionKey);
      if (isTrade) this._connectTradeStream(symbol, interval, exchangeType, subscriptionKey);
      else this._connectKlineStream(symbol, interval, exchangeType, subscriptionKey);
    }, delay);
  }

  unsubscribe(symbol, interval, exchangeType) {
    const subscriptionKey = `${symbol}:${interval}:${exchangeType}`;
    const sub = this.subscriptions.get(subscriptionKey);
    if (!sub) return;
    if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
    if (sub.pingTimer) clearInterval(sub.pingTimer);
    if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
    if (sub.ws) { try { sub.ws.close(); } catch (e) { /* ignore */ } }
    this.subscriptions.delete(subscriptionKey);
    const agg = this.aggregators.get(subscriptionKey);
    if (agg) { agg.flush(); agg.reset(); this.aggregators.delete(subscriptionKey); }
  }

  close() {
    console.log('[GateWs] Closing all connections...');
    for (const [, sub] of this.subscriptions) {
      if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (sub.ws) { try { sub.ws.close(); } catch (e) { /* ignore */ } }
    }
    for (const [, agg] of this.aggregators) { agg.reset(); }
    this.subscriptions.clear();
    this.aggregators.clear();
    console.log('[GateWs] All connections closed');
  }
}

module.exports = GateWsAdapter;
