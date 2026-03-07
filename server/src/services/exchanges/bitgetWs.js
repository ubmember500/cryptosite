/**
 * Bitget WebSocket Adapter
 * Sub-minute (1s/5s/15s): subscribes to trade channel and aggregates via CandleAggregator
 * Minute+: subscribes to candle channel (as before)
 */

const WebSocket = require('ws');
const CandleAggregator = require('../../utils/CandleAggregator');

const WS_URL = 'wss://ws.bitget.com/v2/ws/public';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 30000;

function mapIntervalToBitget(interval) {
  const map = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
  return map[interval] || interval;
}

class BitgetWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.aggregators = new Map();
    console.log('[BitgetWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    if (this.subscriptions.has(subscriptionKey)) return;
    console.log(`[BitgetWs] Subscribing: ${subscriptionKey}`);
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    if (isSubMinute) {
      this._connectTradeStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
    } else {
      this._connectKlineStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
    }
  }

  // ---- Trade stream (sub-minute) ----
  _connectTradeStream(symbol, interval, exchangeType, subscriptionKey) {
    const instType = exchangeType === 'futures' ? 'USDT-FUTURES' : 'SPOT';
    const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[interval];
    const aggregator = new CandleAggregator(spanSec);
    aggregator.on('candle', (candle) => { this.onKlineUpdate(symbol, interval, exchangeType, candle); });
    this.aggregators.set(subscriptionKey, aggregator);

    let ws;
    try { ws = new WebSocket(WS_URL); } catch (error) {
      console.error(`[BitgetWs] Failed to create trade WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, true);
      return;
    }
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, targetInterval: interval, exchangeType, isTrade: true, instType };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      console.log(`[BitgetWs] Trade stream connected: ${subscriptionKey}`);
      sub.reconnectAttempts = 0;
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType, channel: 'trade', instId: symbol }] }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) { console.error(`[BitgetWs] Trade sub timeout: ${subscriptionKey}`); ws.close(); } }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const raw = data.toString();
        if (raw === 'pong') return;
        const message = JSON.parse(raw);
        if (message.event === 'subscribe') {
          sub.confirmed = true;
          if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; }
          return;
        }
        if (message.event === 'error' || message.code) { console.error(`[BitgetWs] Trade error:`, message); return; }
        // Trade data: { action: "snapshot"|"update", arg: { channel: "trade", ... }, data: [{ ts, px, sz, side }] }
        if (message.data && Array.isArray(message.data) && message.arg && message.arg.channel === 'trade') {
          for (const trade of message.data) {
            aggregator.addTrade({ price: parseFloat(trade.px), quantity: parseFloat(trade.sz), timestampMs: parseInt(trade.ts) });
          }
        }
      } catch (err) { console.error(`[BitgetWs] Trade parse error:`, err.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, true);
    });
    ws.on('error', (error) => { console.error(`[BitgetWs] Trade WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Kline stream (minute+) ----
  _connectKlineStream(symbol, interval, exchangeType, subscriptionKey) {
    const instType = exchangeType === 'futures' ? 'USDT-FUTURES' : 'SPOT';
    let ws;
    try { ws = new WebSocket(WS_URL); } catch (error) {
      console.error(`[BitgetWs] Failed to create kline WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, false);
      return;
    }
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, targetInterval: interval, exchangeType, isTrade: false, instType };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      sub.reconnectAttempts = 0;
      const bitgetInterval = mapIntervalToBitget(interval);
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType, channel: 'candle' + bitgetInterval, instId: symbol }] }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) ws.close(); }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const raw = data.toString();
        if (raw === 'pong') return;
        const message = JSON.parse(raw);
        if (message.event === 'subscribe') { sub.confirmed = true; if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; } return; }
        if (message.event === 'error' || message.code) { console.error(`[BitgetWs] Kline error:`, message); return; }
        if (message.data && Array.isArray(message.data)) {
          let candleData;
          if (message.action === 'snapshot') {
            candleData = message.data[message.data.length - 1];
          } else {
            candleData = message.data[0];
          }
          if (!Array.isArray(candleData) || candleData.length < 6) return;
          const kline = { time: Math.floor(parseInt(candleData[0]) / 1000), open: parseFloat(candleData[1]), high: parseFloat(candleData[2]), low: parseFloat(candleData[3]), close: parseFloat(candleData[4]), volume: parseFloat(candleData[5]), isClosed: false };
          this.onKlineUpdate(symbol, interval, exchangeType, kline);
        }
      } catch (error) { console.error(`[BitgetWs] Kline parse error:`, error.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, false);
    });
    ws.on('error', (error) => { console.error(`[BitgetWs] Kline WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Reconnection ----
  _scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, attempts, isTrade) {
    if (!this.subscriptions.has(subscriptionKey)) return;
    const sub = this.subscriptions.get(subscriptionKey);
    sub.reconnectAttempts = attempts + 1;
    if (sub.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[BitgetWs] Max reconnect attempts for ${subscriptionKey}`);
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
    console.log('[BitgetWs] Closing all connections...');
    for (const [, sub] of this.subscriptions) {
      if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (sub.ws) { try { sub.ws.close(); } catch (e) { /* ignore */ } }
    }
    for (const [, agg] of this.aggregators) { agg.reset(); }
    this.subscriptions.clear();
    this.aggregators.clear();
    console.log('[BitgetWs] All connections closed');
  }
}

module.exports = BitgetWsAdapter;
