const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const marketController = require('./controllers/marketController');

const app = express();

// Trust the first proxy hop (required on Render, Railway, Heroku, etc.)
// Without this, req.ip is always the internal proxy IP → everyone shares one rate-limit bucket.
app.set('trust proxy', 1);

const configuredFrontendOrigins = String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  'http://localhost:5173',
  ...configuredFrontendOrigins,
]);

const isLocalDevOrigin = (origin) =>
  /^http:\/\/localhost:\d+$/.test(origin) ||
  /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);

const isTrustedVercelOrigin = (origin) =>
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || isLocalDevOrigin(origin) || isTrustedVercelOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Density scanner diagnostics (no auth — for debugging)
app.get('/api/density-screener/diag', async (req, res) => {
  try {
    const densityScannerService = require('./services/densityScanner');
    const status = densityScannerService.getStatus();
    const walls = densityScannerService.getWalls();

    // Summarize walls by exchange+market
    const summary = {};
    for (const w of walls) {
      const key = `${w.exchange}_${w.market}`;
      if (!summary[key]) summary[key] = { total: 0, above300K: 0, above500K: 0, above1M: 0, top5: [] };
      summary[key].total++;
      if (w.volumeUSD >= 300000) summary[key].above300K++;
      if (w.volumeUSD >= 500000) summary[key].above500K++;
      if (w.volumeUSD >= 1000000) summary[key].above1M++;
      if (summary[key].top5.length < 5) {
        summary[key].top5.push({ sym: w.symbol, side: w.side, vol: Math.round(w.volumeUSD) });
      }
    }

    // ── Live test: call Vercel proxy with 3 symbols and limit=100 ──
    let liveTest = null;
    try {
      const axios = require('axios');
      const proxyURL = process.env.VERCEL_PROXY_URL || 'https://cryptosite2027.vercel.app';
      const testSymbols = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'];
      const resp = await axios.get(`${proxyURL}/api/binance-depth`, {
        params: { market: 'futures', symbols: testSymbols.join(','), limit: 100 },
        timeout: 12000,
      });
      const books = resp.data.books || {};
      const bookSummary = {};
      for (const [sym, book] of Object.entries(books)) {
        bookSummary[sym] = {
          bidLevels: (book.bids || []).length,
          askLevels: (book.asks || []).length,
          topBid: book.bids?.[0],
          topAsk: book.asks?.[0],
        };
      }
      liveTest = {
        proxyURL,
        requestedSymbols: testSymbols,
        returnedBooks: Object.keys(books).length,
        elapsed: resp.data.elapsed,
        bookSummary,
      };
    } catch (e) {
      liveTest = { error: e.message };
    }

    // ── Scanner internal state ──
    const scannerState = {};
    if (densityScannerService.scanners) {
      for (const [key, scanner] of Object.entries(densityScannerService.scanners)) {
        scannerState[key] = {
          type: scanner.constructor.name,
          cachedSymbols: scanner.cachedSymbols?.length || 0,
          groups: scanner._groups?.length || 0,
          groupSizes: scanner._groups?.map(g => g.length) || [],
          currentGroupIndex: scanner.currentGroupIndex || 0,
          proxyURL: scanner.proxyURL || null,
          market: scanner.market || null,
        };
      }
    }

    res.json({
      status: status.exchanges,
      tracker: status.tracker,
      wallSummary: summary,
      totalWalls: walls.length,
      liveTest,
      scannerState,
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// API routes
app.get('/api/binance-klines', marketController.getBinanceFuturesKlinesProxy);
app.use('/api/market', require('./routes/market'));
app.use('/api/wall-scanner', require('./routes/wallScanner'));
app.use('/api/density-screener', require('./routes/densityScreener'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/activity', require('./routes/activity'));
app.use('/admin', require('./routes/adminActivityPage'));

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
