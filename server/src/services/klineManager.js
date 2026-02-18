/**
 * Kline Manager Service
 * Manages real-time kline (candlestick) subscriptions across all exchanges
 * Handles subscription lifecycle, WebSocket connections, and data routing
 */

const BinanceWsAdapter = require('./exchanges/binanceWs');
const BybitWsAdapter = require('./exchanges/bybitWs');
const OkxWsAdapter = require('./exchanges/okxWs');
const GateWsAdapter = require('./exchanges/gateWs');
const BitgetWsAdapter = require('./exchanges/bitgetWs');
const MexcWsAdapter = require('./exchanges/mexcWs');

class KlineManager {
  constructor() {
    // Map of clientId -> Set of subscription keys
    // subscription key format: "exchange:symbol:interval:exchangeType"
    this.clientSubscriptions = new Map();

    // Map of subscription key -> Set of clientIds
    // Used to track which clients are subscribed to each stream
    this.subscriptionClients = new Map();

    // Map of exchange name -> adapter instance
    this.exchangeAdapters = new Map();

    // Socket.IO instance for emitting updates
    this.io = null;

    console.log('[KlineManager] Initialized');
  }

  /**
   * Initialize with Socket.IO instance
   * @param {Object} io - Socket.IO server instance
   */
  initialize(io) {
    this.io = io;
    console.log('[KlineManager] Connected to Socket.IO');
  }

  /**
   * Get or create exchange adapter
   * @param {string} exchange - Exchange name (binance, bybit, okx, gate, bitget, mexc)
   * @returns {Object} Exchange adapter instance
   */
  getExchangeAdapter(exchange) {
    if (this.exchangeAdapters.has(exchange)) {
      return this.exchangeAdapters.get(exchange);
    }

    // Create adapter with kline update callback
    const onKlineUpdate = (symbol, interval, exchangeType, klineData) => {
      this.handleKlineUpdate(exchange, symbol, interval, exchangeType, klineData);
    };

    let adapter;
    switch (exchange.toLowerCase()) {
      case 'binance':
        adapter = new BinanceWsAdapter(onKlineUpdate);
        break;
      case 'bybit':
        adapter = new BybitWsAdapter(onKlineUpdate);
        break;
      case 'okx':
        adapter = new OkxWsAdapter(onKlineUpdate);
        break;
      case 'gate':
        adapter = new GateWsAdapter(onKlineUpdate);
        break;
      case 'bitget':
        adapter = new BitgetWsAdapter(onKlineUpdate);
        break;
      case 'mexc':
        adapter = new MexcWsAdapter(onKlineUpdate);
        break;
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }

    this.exchangeAdapters.set(exchange, adapter);
    console.log(`[KlineManager] Created adapter for ${exchange}`);
    return adapter;
  }

  /**
   * Subscribe a client to kline updates
   * @param {string} clientId - Socket ID
   * @param {string} exchange - Exchange name
   * @param {string} symbol - Trading pair symbol (e.g., BTCUSDT)
   * @param {string} interval - Time interval (1m, 5m, 15m, etc.)
   * @param {string} exchangeType - 'futures' or 'spot'
   */
  subscribe(clientId, exchange, symbol, interval, exchangeType) {
    const subscriptionKey = `${exchange}:${symbol}:${interval}:${exchangeType}`;

    console.log(`[KlineManager] Subscribe: ${clientId} -> ${subscriptionKey}`);

    // Track client subscription
    if (!this.clientSubscriptions.has(clientId)) {
      this.clientSubscriptions.set(clientId, new Set());
    }
    this.clientSubscriptions.get(clientId).add(subscriptionKey);

    // Track subscription clients
    if (!this.subscriptionClients.has(subscriptionKey)) {
      this.subscriptionClients.set(subscriptionKey, new Set());
    }
    const clients = this.subscriptionClients.get(subscriptionKey);
    const isFirstClient = clients.size === 0;
    clients.add(clientId);

    // If this is the first client for this subscription, start the stream
    if (isFirstClient) {
      try {
        const adapter = this.getExchangeAdapter(exchange);
        adapter.subscribe(symbol, interval, exchangeType);
        console.log(`[KlineManager] Started stream: ${subscriptionKey}`);
      } catch (error) {
        console.error(`[KlineManager] Failed to start stream ${subscriptionKey}:`, error.message);
        // Clean up on error
        clients.delete(clientId);
        if (clients.size === 0) {
          this.subscriptionClients.delete(subscriptionKey);
        }
        this.clientSubscriptions.get(clientId)?.delete(subscriptionKey);
      }
    } else {
      console.log(`[KlineManager] Joined existing stream: ${subscriptionKey} (${clients.size} clients)`);
    }
  }

  /**
   * Unsubscribe a client from kline updates
   * @param {string} clientId - Socket ID
   * @param {string} exchange - Exchange name
   * @param {string} symbol - Trading pair symbol
   * @param {string} interval - Time interval
   * @param {string} exchangeType - 'futures' or 'spot'
   */
  unsubscribe(clientId, exchange, symbol, interval, exchangeType) {
    const subscriptionKey = `${exchange}:${symbol}:${interval}:${exchangeType}`;

    console.log(`[KlineManager] Unsubscribe: ${clientId} -> ${subscriptionKey}`);

    // Remove from client subscriptions
    const clientSubs = this.clientSubscriptions.get(clientId);
    if (clientSubs) {
      clientSubs.delete(subscriptionKey);
      if (clientSubs.size === 0) {
        this.clientSubscriptions.delete(clientId);
      }
    }

    // Remove from subscription clients
    const clients = this.subscriptionClients.get(subscriptionKey);
    if (clients) {
      clients.delete(clientId);

      // If no more clients, stop the stream
      if (clients.size === 0) {
        this.subscriptionClients.delete(subscriptionKey);
        try {
          const adapter = this.exchangeAdapters.get(exchange);
          if (adapter) {
            adapter.unsubscribe(symbol, interval, exchangeType);
            console.log(`[KlineManager] Stopped stream: ${subscriptionKey}`);
          }
        } catch (error) {
          console.error(`[KlineManager] Failed to stop stream ${subscriptionKey}:`, error.message);
        }
      } else {
        console.log(`[KlineManager] Client left stream: ${subscriptionKey} (${clients.size} clients remaining)`);
      }
    }
  }

  /**
   * Handle client disconnect - cleanup all subscriptions
   * @param {string} clientId - Socket ID
   */
  handleClientDisconnect(clientId) {
    console.log(`[KlineManager] Client disconnected: ${clientId}`);

    const clientSubs = this.clientSubscriptions.get(clientId);
    if (!clientSubs) {
      return;
    }

    // Unsubscribe from all streams
    for (const subscriptionKey of clientSubs) {
      const [exchange, symbol, interval, exchangeType] = subscriptionKey.split(':');
      this.unsubscribe(clientId, exchange, symbol, interval, exchangeType);
    }
  }

  /**
   * Handle kline update from exchange adapter
   * Emit to all subscribed clients
   * @param {string} exchange - Exchange name
   * @param {string} symbol - Trading pair symbol
   * @param {string} interval - Time interval
   * @param {string} exchangeType - 'futures' or 'spot'
   * @param {Object} klineData - Kline data
   */
  handleKlineUpdate(exchange, symbol, interval, exchangeType, klineData) {
    const subscriptionKey = `${exchange}:${symbol}:${interval}:${exchangeType}`;
    
    console.log(`[KlineManager] handleKlineUpdate called for ${subscriptionKey}`, {
      close: klineData.close,
      time: new Date(klineData.time * 1000).toISOString(),
      isClosed: klineData.isClosed,
    });
    
    const clients = this.subscriptionClients.get(subscriptionKey);

    if (!clients || clients.size === 0) {
      console.warn(`[KlineManager] No clients subscribed to ${subscriptionKey}`);
      return;
    }

    if (!this.io) {
      console.error('[KlineManager] Socket.IO not initialized!');
      return;
    }

    // Emit to all subscribed clients
    const updateData = {
      exchange,
      symbol,
      interval,
      exchangeType,
      kline: klineData,
    };

    console.log(`[KlineManager] Emitting kline-update to ${clients.size} client(s): ${Array.from(clients).join(', ')}`);
    
    clients.forEach((clientId) => {
      this.io.to(clientId).emit('kline-update', updateData);
      console.log(`[KlineManager] Emitted to client: ${clientId}`);
    });
  }

  /**
   * Get statistics about active subscriptions
   * @returns {Object} Statistics
   */
  getStats() {
    const stats = {
      totalClients: this.clientSubscriptions.size,
      totalSubscriptions: this.subscriptionClients.size,
      activeExchanges: this.exchangeAdapters.size,
      subscriptionsByExchange: this.getSubscriptionsByExchange(),
      detailedSubscriptions: this.getDetailedSubscriptions(),
    };
    
    console.log('[KlineManager] 📊 Stats:', JSON.stringify(stats, null, 2));
    return stats;
  }

  /**
   * Get subscriptions grouped by exchange
   * @returns {Object} Subscriptions by exchange
   */
  getSubscriptionsByExchange() {
    const byExchange = {};
    for (const key of this.subscriptionClients.keys()) {
      const [exchange] = key.split(':');
      byExchange[exchange] = (byExchange[exchange] || 0) + 1;
    }
    return byExchange;
  }

  /**
   * Get detailed list of all active subscriptions
   * @returns {Array} Array of subscription details
   */
  getDetailedSubscriptions() {
    const subscriptions = [];
    for (const [key, clients] of this.subscriptionClients) {
      const [exchange, symbol, interval, exchangeType] = key.split(':');
      subscriptions.push({
        key,
        exchange,
        symbol,
        interval,
        exchangeType,
        clientCount: clients.size,
        clientIds: Array.from(clients),
      });
    }
    return subscriptions;
  }

  /**
   * Shutdown - close all connections
   */
  shutdown() {
    console.log('[KlineManager] Shutting down...');

    // Close all exchange adapters
    for (const [exchange, adapter] of this.exchangeAdapters) {
      try {
        adapter.close();
        console.log(`[KlineManager] Closed adapter: ${exchange}`);
      } catch (error) {
        console.error(`[KlineManager] Error closing adapter ${exchange}:`, error.message);
      }
    }

    // Clear all data
    this.exchangeAdapters.clear();
    this.clientSubscriptions.clear();
    this.subscriptionClients.clear();

    console.log('[KlineManager] Shutdown complete');
  }
}

// Export singleton instance
const klineManager = new KlineManager();
module.exports = klineManager;
