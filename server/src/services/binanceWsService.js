const binanceService = require('./binanceService');

const WS_BASE_URL = 'wss://fstream.binance.com/stream?streams=';
const MAX_STREAMS_PER_CONNECTION = 200;
const RECONNECT_DELAY_MS = 5000;
const STATS_INTERVAL_MS = 60000;
const DEFAULT_INTERVAL = '1m';

// In-memory kline data store
// Key: "SYMBOL:interval" (e.g., "BTCUSDT:1m")
// Value: { open, high, low, close, startTime, eventTime }
const klineData = new Map();

// Connection management
let connections = []; // Array of WebSocket instances
let stopping = false;
let reconnectTimers = [];
let statsTimer = null;

/**
 * Split an array into chunks of a given size.
 * @param {Array} arr
 * @param {number} size
 * @returns {Array<Array>}
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Handle an incoming kline WebSocket message.
 * Parses the message and updates the klineData Map.
 * @param {string} raw - Raw message string from WebSocket
 */
function handleMessage(raw) {
  try {
    const msg = JSON.parse(raw);
    const k = msg.data && msg.data.k;
    if (!k) return;

    const symbol = k.s; // Uppercase symbol, e.g. "BTCUSDT"
    const interval = k.i; // e.g. "1m"
    const key = `${symbol}:${interval}`;

    klineData.set(key, {
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      startTime: k.t,
      eventTime: msg.data.E,
    });
  } catch (err) {
    // Silently ignore malformed messages
  }
}

/**
 * Open a WebSocket connection for a chunk of stream names.
 * Automatically reconnects on close/error unless stop() has been called.
 * @param {string[]} streams - Array of stream names (e.g., ["btcusdt@kline_1m", ...])
 * @param {number} chunkIndex - Index of this chunk (for logging)
 */
function openConnection(streams, chunkIndex) {
  if (stopping) return;

  const url = WS_BASE_URL + streams.join('/');
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error(`[BinanceWS] Failed to create WebSocket for chunk ${chunkIndex}:`, err.message);
    scheduleReconnect(streams, chunkIndex);
    return;
  }

  connections[chunkIndex] = ws;

  ws.onopen = () => {
    console.log(`[BinanceWS] Connection ${chunkIndex} opened (${streams.length} streams)`);
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === 'string' ? event.data : String(event.data);
    handleMessage(data);
  };

  ws.onclose = (event) => {
    console.warn(`[BinanceWS] Connection ${chunkIndex} closed (code: ${event.code})`);
    connections[chunkIndex] = null;
    scheduleReconnect(streams, chunkIndex);
  };

  ws.onerror = (err) => {
    console.error(`[BinanceWS] Connection ${chunkIndex} error:`, err.message || 'Unknown error');
    // onclose will fire after onerror, which handles reconnection
  };
}

/**
 * Schedule a reconnection attempt for a chunk after a delay.
 * @param {string[]} streams
 * @param {number} chunkIndex
 */
function scheduleReconnect(streams, chunkIndex) {
  if (stopping) return;
  console.log(`[BinanceWS] Reconnecting chunk ${chunkIndex} in ${RECONNECT_DELAY_MS / 1000}s...`);
  const timer = setTimeout(() => {
    if (!stopping) {
      openConnection(streams, chunkIndex);
    }
  }, RECONNECT_DELAY_MS);
  reconnectTimers.push(timer);
}

/**
 * Start the WebSocket connections.
 * 1. Fetch active USDT futures symbols from Binance REST API (via binanceService).
 * 2. Subscribe to 1m klines for all symbols.
 * 3. Split into chunks of 200 streams, open one WebSocket per chunk.
 * 4. On each message, parse and update the klineData Map.
 */
async function start() {
  stopping = false;
  klineData.clear();
  connections = [];
  reconnectTimers = [];

  // Fetch active futures symbols
  const activeSymbols = await binanceService.fetchActiveSymbols('futures');
  if (!activeSymbols || activeSymbols.size === 0) {
    console.error('[BinanceWS] No active futures symbols found. Cannot start WebSocket connections.');
    return;
  }

  const symbols = Array.from(activeSymbols);
  const interval = DEFAULT_INTERVAL;

  // Build stream names: <symbol_lowercase>@kline_<interval>
  const streams = symbols.map((s) => `${s.toLowerCase()}@kline_${interval}`);

  console.log(`[BinanceWS] Subscribing to ${symbols.length} symbols on ${interval} klines`);

  // Split streams into chunks of MAX_STREAMS_PER_CONNECTION
  const streamChunks = chunk(streams, MAX_STREAMS_PER_CONNECTION);
  console.log(`[BinanceWS] Opening ${streamChunks.length} WebSocket connection(s)`);

  // Open one connection per chunk
  for (let i = 0; i < streamChunks.length; i++) {
    openConnection(streamChunks[i], i);
  }

  // Start periodic stats logging
  statsTimer = setInterval(() => {
    const symbolsWithData = new Set();
    for (const key of klineData.keys()) {
      const symbol = key.slice(0, key.lastIndexOf(':'));
      symbolsWithData.add(symbol);
    }
    console.log(
      `[BinanceWS] Stats: ${symbolsWithData.size}/${symbols.length} symbols have kline data, ${klineData.size} total entries`
    );
  }, STATS_INTERVAL_MS);
}

/**
 * Get current kline data for a symbol and interval.
 * @param {string} symbol - e.g., 'BTCUSDT'
 * @param {string} interval - e.g., '1m'
 * @returns {{ open: number, high: number, low: number, close: number, startTime: number, eventTime: number } | null}
 */
function getKline(symbol, interval) {
  return klineData.get(`${symbol}:${interval}`) || null;
}

/**
 * Get ALL current kline data (for batch checking by alert engine).
 * @param {string} interval - e.g., '1m'
 * @returns {Map<string, {open: number, high: number, low: number, close: number, startTime: number}>} symbol → kline
 */
function getAllKlines(interval) {
  const result = new Map();
  for (const [key, value] of klineData) {
    if (key.endsWith(`:${interval}`)) {
      const symbol = key.slice(0, -(interval.length + 1));
      result.set(symbol, value);
    }
  }
  return result;
}

/**
 * Stop all WebSocket connections. Call on server shutdown.
 */
function stop() {
  stopping = true;

  // Clear all reconnect timers
  for (const timer of reconnectTimers) {
    clearTimeout(timer);
  }
  reconnectTimers = [];

  // Clear stats timer
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }

  // Close all connections
  for (let i = 0; i < connections.length; i++) {
    const ws = connections[i];
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  }
  connections = [];

  console.log('[BinanceWS] All connections stopped');
}

module.exports = { start, stop, getKline, getAllKlines };
