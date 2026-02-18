const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');
const subscriptionController = require('./controllers/subscriptionController');

const app = express();

// CORS configuration
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/market', require('./routes/market'));
app.use('/api/wall-scanner', require('./routes/wallScanner'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/subscription', require('./routes/subscription'));
// Subscription routes (direct mount so they are always available)
app.get('/api/subscription/currencies', authMiddleware, subscriptionController.getCurrencies);
app.post('/api/subscription/create-pro-payment', authMiddleware, subscriptionController.createProPayment);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
