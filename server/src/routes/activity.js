const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');
const optionalAuthMiddleware = require('../middleware/optionalAuth');
const { recordActivityBatch, getSiteActivitySummary } = require('../services/activityService');
const prisma = require('../utils/prisma');

const router = express.Router();

function startOfUtcDay(dateInput = new Date()) {
  const date = new Date(dateInput);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isMissingTableError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = String(error?.message || '').toLowerCase();
  return code === 'P2021' || code === 'P2022' || message.includes('does not exist');
}

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

    let daily;
    let totals;

    try {
      [daily, totals] = await Promise.all([
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
    } catch (err) {
      if (!isMissingTableError(err)) {
        throw err;
      }

      const events = await prisma.userActivityEvent.findMany({
        where: {
          userId: req.user.id,
          occurredAt: { gte: start },
        },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true, eventType: true },
      });

      totals = events.length;
      const byDay = new Map();

      for (const event of events) {
        const day = startOfUtcDay(event.occurredAt);
        const key = day.getTime();
        const row = byDay.get(key) || {
          day,
          eventCount: 0,
          pageViewCount: 0,
          clickCount: 0,
          loginCount: 0,
          firstSeenAt: event.occurredAt,
          lastSeenAt: event.occurredAt,
        };

        row.eventCount += 1;
        if (event.eventType === 'page_view') row.pageViewCount += 1;
        if (event.eventType === 'click') row.clickCount += 1;
        if (event.eventType === 'login') row.loginCount += 1;
        if (event.occurredAt < row.firstSeenAt) row.firstSeenAt = event.occurredAt;
        if (event.occurredAt > row.lastSeenAt) row.lastSeenAt = event.occurredAt;

        byDay.set(key, row);
      }

      daily = Array.from(byDay.values()).sort((a, b) => new Date(a.day) - new Date(b.day));
    }

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
