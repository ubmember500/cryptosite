const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const densityScreenerController = require('../controllers/densityScreenerController');

// GET /api/density-screener/walls — main filtered walls data
router.get('/walls', authMiddleware, densityScreenerController.getWalls);

// GET /api/density-screener/symbols — available symbols for token selector
router.get('/symbols', authMiddleware, densityScreenerController.getSymbols);

// GET /api/density-screener/status — scanner health
router.get('/status', authMiddleware, densityScreenerController.getStatus);

module.exports = router;
