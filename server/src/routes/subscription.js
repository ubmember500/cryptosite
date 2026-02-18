const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const authMiddleware = require('../middleware/auth');

/**
 * Subscription / payment routes
 * - GET  /api/subscription - Health check (confirms router is mounted)
 * - GET  /api/subscription/currencies - Available payment currencies (protected)
 * - POST /api/subscription/create-pro-payment - Create $14 PRO payment (protected)
 */
router.get('/', (req, res) => res.json({ ok: true, service: 'subscription' }));
router.get('/currencies', authMiddleware, subscriptionController.getCurrencies);
router.post('/create-pro-payment', authMiddleware, subscriptionController.createProPayment);

module.exports = router;
