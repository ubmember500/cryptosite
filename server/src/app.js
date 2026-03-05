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

// Temporary diagnostic (remove after verifying deploy)
app.get('/api/density-screener/diag', (req, res) => {
  try {
    const svc = require('./services/densityScanner');
    const walls = svc.getWalls();
    const summary = {};
    for (const w of walls) {
      const k = `${w.exchange}_${w.market}`;
      if (!summary[k]) summary[k] = { total: 0, gt300K: 0, gt500K: 0, gt1M: 0, top3: [] };
      summary[k].total++;
      if (w.volumeUSD >= 300000) summary[k].gt300K++;
      if (w.volumeUSD >= 500000) summary[k].gt500K++;
      if (w.volumeUSD >= 1000000) summary[k].gt1M++;
      if (summary[k].top3.length < 3) summary[k].top3.push({ s: w.symbol, v: Math.round(w.volumeUSD) });
    }
    const aster = walls.filter(w => w.symbol === 'ASTERUSDT').sort((a, b) => b.volumeUSD - a.volumeUSD).slice(0, 5)
      .map(w => ({ side: w.side, vol: Math.round(w.volumeUSD), price: w.price }));
    res.json({ total: walls.length, summary, aster });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
