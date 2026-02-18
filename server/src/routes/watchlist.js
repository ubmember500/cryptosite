const express = require('express');
const router = express.Router();
const watchlistController = require('../controllers/watchlistController');
const authMiddleware = require('../middleware/auth');

/**
 * Watchlist Routes (all protected)
 * - GET /api/watchlist - Get user's watchlist
 * - POST /api/watchlist - Add coin to watchlist
 * - DELETE /api/watchlist/:coinId - Remove coin from watchlist
 */
router.get('/', authMiddleware, watchlistController.getWatchlist);
router.post('/', authMiddleware, watchlistController.addToWatchlist);
router.delete('/:coinId', authMiddleware, watchlistController.removeFromWatchlist);

module.exports = router;
