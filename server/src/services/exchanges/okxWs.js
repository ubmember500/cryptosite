/**
 * OKX WebSocket Adapter
 * Sub-minute (1s/5s/15s): subscribes to trades on public WS and aggregates via CandleAggregator
 * Minute+: subscribes to candle channel on business WS (as before)
 */

const WebSocket = require('ws');
const CandleAggregator = require('../../utils/CandleAggregator');

const BUSINESS_WS_URL = 'wss://ws.okx.com:8443/ws/v5/business';
const PUBLIC_WS_URL   = 'wss://ws.okx.com:8443/ws/v5/public';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 25000;

function mapIntervalToOKX(interval) {
  const map = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
  return map[interval] || interval;
}

function formatSymbolForOKX(symbol, exchangeType) {
  const base = symbol.replace('USDT', '');
  return exchangeType === 'futures' ? `${base}-USDT-SWAP` : `${base}-USDT`;
}

class OkxWsAdapter {
  constructor(onKlineUpdate) {
    this.onKlineUpdate = onKlineUpdate;
    this.subscriptions = new Map();
    this.aggregators = new Map();
    console.log('[OkxWs] Adapter initialized');
  }

  subscribe(symbol, interval, exchangeType) {
    const normalizedSymbol = symbol.toUpperCase();
    const subscriptionKey = `${normalizedSymbol}:${interval}:${exchangeType}`;
    if (this.subscriptions.has(subscriptionKey)) return;
    console.log(`[OkxWs] Subscribing: ${subscriptionKey}`);
    const isSubMinute = ['1s', '5s', '15s'].includes(interval);
    if (isSubMinute) {
      this._connectTradeStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
    } else {
      this._connectKlineStream(normalizedSymbol, interval, exchangeType, subscriptionKey);
    }
  }

  // ---- Trade stream (sub-minute) ----
  _connectTradeStream(symbol, interval, exchangeType, subscriptionKey) {
    const okxSymbol = formatSymbolForOKX(symbol, exchangeType);
    const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[interval];
    const aggregator = new CandleAggregator(spanSec);
    aggregator.on('candle', (candle) => { this.onKlineUpdate(symbol, interval, exchangeType, candle); });
    this.aggregators.set(subscriptionKey, aggregator);

    let ws;
    try { ws = new WebSocket(PUBLIC_WS_URL); } catch (error) {
      console.error(`[OkxWs] Failed to create trade WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, true);
      return;
    }
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, targetInterval: interval, exchangeType, isTrade: true, okxSymbol };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      console.log(`[OkxWs] Trade stream connected: ${subscriptionKey}`);
      sub.reconnectAttempts = 0;
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'trades', instId: okxSymbol }] }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) { console.error(`[OkxWs] Trade sub timeout: ${subscriptionKey}`); ws.close(); } }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const raw = data.toString();
        if (raw === 'pong') return;
        const message = JSON.parse(raw);
        if (message.event === 'subscribe') {
          if (!message.code || message.code === '0') { sub.confirmed = true; if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; } }
          return;
        }
        if (message.event === 'error') { console.error(`[OkxWs] Trade error: ${subscriptionKey}`, message); return; }
        if (message.arg && message.arg.channel === 'trades' && message.data) {
          for (const trade of message.data) {
            aggregator.addTrade({ price: parseFloat(trade.px), quantity: parseFloat(trade.sz), timestampMs: parseInt(trade.ts) });
          }
        }
      } catch (err) { console.error(`[OkxWs] Trade parse error:`, err.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, true);
    });
    ws.on('error', (error) => { console.error(`[OkxWs] Trade WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Kline stream (minute+) ----
  _connectKlineStream(symbol, interval, exchangeType, subscriptionKey) {
    const okxSymbol = formatSymbolForOKX(symbol, exchangeType);
    let ws;
    try { ws = new WebSocket(BUSINESS_WS_URL); } catch (error) {
      console.error(`[OkxWs] Failed to create kline WS for ${subscriptionKey}:`, error.message);
      this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, 0, false);
      return;
    }
    const sub = { ws, reconnectAttempts: 0, reconnectTimer: null, pingTimer: null, subscriptionTimeout: null, confirmed: false, symbol, targetInterval: interval, exchangeType, isTrade: false, okxSymbol };
    this.subscriptions.set(subscriptionKey, sub);

    ws.on('open', () => {
      sub.reconnectAttempts = 0;
      const okxInterval = mapIntervalToOKX(interval);
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: `candle${okxInterval}`, instId: okxSymbol }] }));
      sub.subscriptionTimeout = setTimeout(() => { if (!sub.confirmed) ws.close(); }, 10000);
      sub.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, PING_INTERVAL_MS);
    });
    ws.on('message', (data) => {
      try {
        const raw = data.toString();
        if (raw === 'pong') return;
        const message = JSON.parse(raw);
        if (message.event === 'subscribe') { if (!message.code || message.code === '0') { sub.confirmed = true; if (sub.subscriptionTimeout) { clearTimeout(sub.subscriptionTimeout); sub.subscriptionTimeout = null; } } return; }
        if (message.event === 'error') { console.error(`[OkxWs] Kline error:`, message); return; }
        if (message.data && Array.isArray(message.data) && message.data.length > 0) {
          const d = message.data[0];
          if (!Array.isArray(d) || d.length < 9) return;
          const kline = { time: Math.floor(parseInt(d[0]) / 1000), open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]), isClosed: d[8] === '1' };
          this.onKlineUpdate(symbol, interval, exchangeType, kline);
        }
      } catch (error) { console.error(`[OkxWs] Kline parse error:`, error.message); }
    });
    ws.on('close', (code) => {
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (this.subscriptions.has(subscriptionKey)) this._scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, sub.reconnectAttempts, false);
    });
    ws.on('error', (error) => { console.error(`[OkxWs] Kline WS error: ${subscriptionKey}:`, error.message); });
  }

  // ---- Reconnection ----
  _scheduleReconnect(symbol, interval, exchangeType, subscriptionKey, attempts, isTrade) {
    if (!this.subscriptions.has(subscriptionKey)) return;
    const sub = this.subscriptions.get(subscriptionKey);
    sub.reconnectAttempts = attempts + 1;
    if (sub.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[OkxWs] Max reconnect attempts for ${subscriptionKey}`);
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
    console.log('[OkxWs] Closing all connections...');
    for (const [, sub] of this.subscriptions) {
      if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
      if (sub.pingTimer) clearInterval(sub.pingTimer);
      if (sub.subscriptionTimeout) clearTimeout(sub.subscriptionTimeout);
      if (sub.ws) { try { sub.ws.close(); } catch (e) { /* ignore */ } }
    }
    for (const [, agg] of this.aggregators) { agg.reset(); }
    this.subscriptions.clear();
    this.aggregators.clear();
    console.log('[OkxWs] All connections closed');
  }
}

module.exports = OkxWsAdapter;
