const express = require('express');
const router = express.Router();
const wallScannerController = require('../controllers/wallScannerController');

/**
 * Wall Scanner Routes (public, no auth)
 *
 * GET /api/wall-scanner/symbols?exchange=binance
 *   -> top 50 USDT futures symbols
 *
 * GET /api/wall-scanner/scan?exchanges=binance,okx&symbols=BTC/USDT,ETH/USDT&depth=50&minVolume=300000&side=Both
 *   -> detected walls (large limit orders)
 *
 * GET /api/wall-scanner/density?exchange=binance&symbol=BTC/USDT&depth=50
 *   -> binned density map for heatmap
 */

router.get('/symbols', wallScannerController.getTopSymbols);
router.get('/scan', wallScannerController.scan);
router.get('/density', wallScannerController.getDensityMap);

module.exports = router;
