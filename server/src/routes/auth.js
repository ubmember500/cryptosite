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

/**
 * GET /api/auth/setup-sendgrid?secret=<secret>
 * Diagnostic endpoint — lists verified SendGrid senders and helps fix sender issues.
 * Protected by DEBUG_EMAIL_SECRET env var.
 *
 * POST /api/auth/setup-sendgrid?secret=<secret>
 * Body: { "email": "your@email.com", "name": "CryptoAlerts" }
 * Creates a verified sender in SendGrid — SendGrid will send a verification link
 * to that email address. User clicks it → sender is verified → emails work.
 */
router.get('/setup-sendgrid', async (req, res) => {
  const secret = process.env.DEBUG_EMAIL_SECRET || 'debug123';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { isSendGridConfigured, getVerifiedSendGridSenders } = require('../utils/email');
    if (!isSendGridConfigured()) {
      return res.json({ configured: false, message: 'SENDGRID_API_KEY not set' });
    }
    const senders = await getVerifiedSendGridSenders();
    res.json({
      configured: true,
      verifiedSenders: senders,
      hint: senders.length === 0
        ? 'No verified senders. POST to this endpoint with { "email": "your@email.com" } to create one, then check your inbox for the verification link.'
        : `Found ${senders.length} verified sender(s). The first one (${senders[0].fromEmail}) will be auto-used.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/setup-sendgrid', async (req, res) => {
  const secret = req.query.secret || req.body.secret;
  const expectedSecret = process.env.DEBUG_EMAIL_SECRET || 'debug123';
  if (secret !== expectedSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { isSendGridConfigured, getSendGridApiKey } = require('../utils/email');
    if (!isSendGridConfigured()) {
      return res.status(400).json({ error: 'SENDGRID_API_KEY not set' });
    }
    const email = req.body.email;
    const name = req.body.name || 'CryptoAlerts';
    if (!email) {
      return res.status(400).json({ error: 'email is required in request body' });
    }

    const apiKey = getSendGridApiKey();
    const https = require('https');
    const payload = JSON.stringify({
      nickname: name,
      from_email: email,
      from_name: name,
      reply_to: email,
      reply_to_name: name,
      address: '1 Crypto St',
      city: 'New York',
      state: 'NY',
      zip: '10001',
      country: 'US',
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.sendgrid.com',
          path: '/v3/verified_senders',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 15_000,
        },
        (resp) => {
          let data = '';
          resp.on('data', (chunk) => (data += chunk));
          resp.on('end', () => {
            try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
            catch { resolve({ status: resp.statusCode, body: data }); }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(payload);
      req.end();
    });

    if (result.status >= 200 && result.status < 300) {
      res.json({
        success: true,
        message: `Verification email sent to ${email}. Check your inbox and click the verification link. Once verified, password reset emails will work automatically.`,
        sendgridResponse: result.body,
      });
    } else {
      res.status(result.status).json({
        success: false,
        error: result.body?.errors?.[0]?.message || JSON.stringify(result.body),
        hint: 'If the email is already pending verification, check your inbox (including spam) for the SendGrid verification email.',
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
