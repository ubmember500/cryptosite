const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');
const optionalAuthMiddleware = require('../middleware/optionalAuth');
const { recordActivityBatch, getSiteActivitySummary } = require('../services/activityService');
const prisma = require('../utils/prisma');

const router = express.Router();

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/track', trackLimiter, optionalAuthMiddleware, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;

    if (events.length === 0) {
      return res.status(400).json({ error: 'events array is required' });
    }

    const result = await recordActivityBatch(events, {
      userId: req.user?.id || null,
      sessionId,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));

    const [daily, totals] = await Promise.all([
      prisma.userDailyActivity.findMany({
        where: {
          userId: req.user.id,
          day: { gte: start },
        },
        orderBy: { day: 'asc' },
        select: {
          day: true,
          eventCount: true,
          pageViewCount: true,
          clickCount: true,
          loginCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
        },
      }),
      prisma.userActivityEvent.count({
        where: {
          userId: req.user.id,
          occurredAt: { gte: start },
        },
      }),
    ]);

    return res.json({
      ok: true,
      days,
      totals: { events: totals },
      daily,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/summary', async (req, res) => {
  const secret = req.query.secret || req.headers['x-activity-secret'];
  const expectedSecret = process.env.ACTIVITY_ADMIN_SECRET || process.env.DEBUG_EMAIL_SECRET || 'debug123';

  if (secret !== expectedSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));
    const summary = await getSiteActivitySummary(days);
    return res.json({ ok: true, ...summary });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
