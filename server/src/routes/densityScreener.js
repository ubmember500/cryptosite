const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const densityScreenerController = require('../controllers/densityScreenerController');
const tokenSettingsController = require('../controllers/tokenSettingsController');

// GET /api/density-screener/walls — main filtered walls data
router.get('/walls', authMiddleware, densityScreenerController.getWalls);

// GET /api/density-screener/symbols — available symbols for token selector
router.get('/symbols', authMiddleware, densityScreenerController.getSymbols);

// GET /api/density-screener/status — scanner health
router.get('/status', authMiddleware, densityScreenerController.getStatus);

// ── Per-user token settings (Individual Settings) ──────────────────────────
router.get('/token-settings', authMiddleware, tokenSettingsController.getTokenSettings);
router.put('/token-settings', authMiddleware, tokenSettingsController.upsertTokenSetting);
router.put('/token-settings/batch', authMiddleware, tokenSettingsController.batchUpsertTokenSettings);
router.delete('/token-settings/reset', authMiddleware, tokenSettingsController.resetTokenSettings);
router.delete('/token-settings/:id', authMiddleware, tokenSettingsController.deleteTokenSetting);

module.exports = router;
