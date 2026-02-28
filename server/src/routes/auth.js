const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

/** Rate limit: forgot-password — 10 requests per hour per IP.
 *  keepin it reasonable for real users who may retry a few times.
 *  trust proxy must be set on the Express app for req.ip to reflect the real client IP on Render/Railway/Heroku.
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many reset requests. Please wait an hour before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

/**
 * Auth Routes
 * - POST /api/auth/register - Register new user
 * - POST /api/auth/login - Login user
 * - GET /api/auth/me - Get current user (protected)
 * - POST /api/auth/refresh - Refresh access token
 * - POST /api/auth/forgot-password - Request password reset
 * - POST /api/auth/reset-password - Reset password with token
 */
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleAuth);
router.get('/me', authMiddleware, authController.getMe);
router.post('/refresh', authController.refresh);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

/**
 * GET /api/auth/debug-email?to=<email>
 * Diagnostic endpoint — tests each email provider and returns per-provider status.
 * Protected by DEBUG_EMAIL_SECRET env var (must match ?secret= query param).
 * Remove or disable once email is confirmed working.
 */
router.get('/debug-email', async (req, res) => {
  const secret = process.env.DEBUG_EMAIL_SECRET || 'debug123';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const to = req.query.to || 'test@example.com';
  try {
    const { debugEmailProviders } = require('../utils/email');
    const results = await debugEmailProviders(to);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
