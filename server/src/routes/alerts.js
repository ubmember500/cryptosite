const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const authMiddleware = require('../middleware/auth');

/**
 * Alert Routes (all protected)
 * - GET /api/alerts - Get user's alerts
 * - POST /api/alerts - Create new alert
 * - PUT /api/alerts/:id - Update alert
 * - DELETE /api/alerts/:id - Delete alert
 * - PATCH /api/alerts/:id/toggle - Toggle alert active state
 * - GET /api/alerts/history - Get alert history
 */
router.get('/', authMiddleware, alertController.getAlerts);
router.post('/', authMiddleware, alertController.createAlert);
router.put('/:id', authMiddleware, alertController.updateAlert);
router.delete('/:id', authMiddleware, alertController.deleteAlert);
router.patch('/:id/toggle', authMiddleware, alertController.toggleAlert);
router.get('/history', authMiddleware, alertController.getHistory);

module.exports = router;
