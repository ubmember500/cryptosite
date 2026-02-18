const express = require('express');
const router = express.Router();
const marketController = require('../controllers/marketController');
const klineManager = require('../services/klineManager');

/**
 * Market Routes (public)
 * - GET /api/market/coins - Get top coins (cached)
 * - GET /api/market/coins/:id - Get single coin details
 * - GET /api/market/search?q= - Search coins
 * Binance:
 * - GET /api/market/binance/tokens?exchangeType=futures|spot&search=
 * - GET /api/market/binance/tokens/:symbol?exchangeType=futures|spot
 * - GET /api/market/binance/klines?symbol=...&exchangeType=...&interval=...&limit=...
 * Bybit:
 * - GET /api/market/bybit/tokens?exchangeType=futures|spot&search=
 * - GET /api/market/bybit/tokens/:symbol?exchangeType=futures|spot
 * - GET /api/market/bybit/klines?symbol=...&exchangeType=...&interval=...&limit=...
 * OKX:
 * - GET /api/market/okx/tokens?exchangeType=futures|spot&search=
 * - GET /api/market/okx/tokens/:symbol?exchangeType=futures|spot
 * - GET /api/market/okx/klines?symbol=...&exchangeType=...&interval=...&limit=...
 * Gate.io:
 * - GET /api/market/gate/tokens?exchangeType=futures|spot&search=
 * - GET /api/market/gate/tokens/:symbol?exchangeType=futures|spot
 * - GET /api/market/gate/klines?symbol=...&exchangeType=...&interval=...&limit=...
 * Bitget:
 * - GET /api/market/bitget/tokens?exchangeType=futures|spot&search=
 * - GET /api/market/bitget/tokens/:symbol?exchangeType=futures|spot
 * - GET /api/market/bitget/klines?symbol=...&exchangeType=...&interval=...&limit=...
 * MEXC:
 * - GET /api/market/mexc/tokens?exchangeType=futures|spot&search=
 * - GET /api/market/mexc/tokens/:symbol?exchangeType=futures|spot
 * - GET /api/market/mexc/klines?symbol=...&exchangeType=...&interval=...&limit=...
 */
router.get('/listings', marketController.getListings);
router.get('/coins', marketController.getCoins);
router.get('/coins/:id', marketController.getCoin);
router.get('/search', marketController.searchCoins);

// Binance routes
router.get('/binance/tokens', marketController.getBinanceTokens);
router.get('/binance/tokens/:symbol', marketController.getBinanceTokenDetails);
router.get('/binance/klines', marketController.getBinanceKlines);
router.get('/binance/market-map', marketController.getBinanceMarketMapRanking);

// Bybit routes (same API shape as Binance)
router.get('/bybit/tokens', marketController.getBybitTokens);
router.get('/bybit/tokens/:symbol', marketController.getBybitTokenDetails);
router.get('/bybit/klines', marketController.getBybitKlines);
router.get('/bybit/market-map', marketController.getBybitMarketMapRanking);

// OKX routes (same API shape as Binance)
router.get('/okx/tokens', marketController.getOkxTokens);
router.get('/okx/tokens/:symbol', marketController.getOkxTokenDetails);
router.get('/okx/klines', marketController.getOkxKlines);

// Gate.io routes (same API shape as Binance)
router.get('/gate/tokens', marketController.getGateTokens);
router.get('/gate/tokens/:symbol', marketController.getGateTokenDetails);
router.get('/gate/klines', marketController.getGateKlines);

// Bitget routes (same API shape as Binance)
router.get('/bitget/tokens', marketController.getBitgetTokens);
router.get('/bitget/tokens/:symbol', marketController.getBitgetTokenDetails);
router.get('/bitget/klines', marketController.getBitgetKlines);

// MEXC routes (same API shape as Binance)
router.get('/mexc/tokens', marketController.getMexcTokens);
router.get('/mexc/tokens/:symbol', marketController.getMexcTokenDetails);
router.get('/mexc/klines', marketController.getMexcKlines);

// Debug endpoint - get real-time subscription stats
router.get('/debug/subscriptions', (req, res) => {
  try {
    const stats = klineManager.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
