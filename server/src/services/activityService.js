const prisma = require('../utils/prisma');

const DEFAULT_SESSION = 'anonymous';
const MAX_LABEL_LENGTH = 180;
const MAX_PATH_LENGTH = 300;
const MAX_ELEMENT_LENGTH = 80;

function startOfUtcDay(dateInput = new Date()) {
  const date = new Date(dateInput);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeEventType(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return 'custom';
  if (['page_view', 'click', 'login', 'register', 'heartbeat', 'custom'].includes(raw)) {
    return raw;
  }
  return 'custom';
}

function safeMetadata(metadata) {
  if (metadata == null) return null;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    const safeKey = key.trim().slice(0, 60);
    if (value == null) {
      normalized[safeKey] = null;
    } else if (typeof value === 'string') {
      normalized[safeKey] = value.slice(0, 300);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[safeKey] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function classifyCounters(eventType) {
  return {
    eventCount: 1,
    pageViewCount: eventType === 'page_view' ? 1 : 0,
    clickCount: eventType === 'click' ? 1 : 0,
    loginCount: eventType === 'login' ? 1 : 0,
  };
}

async function recordSingleActivity(input = {}) {
  const eventType = normalizeEventType(input.eventType);
  const userId = typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : null;
  const sessionId = sanitizeString(input.sessionId, 120) || DEFAULT_SESSION;
  const pagePath = sanitizeString(input.pagePath, MAX_PATH_LENGTH);
  const label = sanitizeString(input.label, MAX_LABEL_LENGTH);
  const element = sanitizeString(input.element, MAX_ELEMENT_LENGTH);
  const metadata = safeMetadata(input.metadata);
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const eventTime = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const day = startOfUtcDay(eventTime);
  const counters = classifyCounters(eventType);

  await prisma.$transaction(async (tx) => {
    await tx.userActivityEvent.create({
      data: {
        userId,
        sessionId,
        eventType,
        pagePath,
        label,
        element,
        metadata,
        occurredAt: eventTime,
      },
    });

    if (!userId) {
      await tx.siteDailyActivity.upsert({
        where: { day },
        create: {
          day,
          eventCount: counters.eventCount,
          pageViewCount: counters.pageViewCount,
          clickCount: counters.clickCount,
          loginCount: counters.loginCount,
          uniqueUsers: 0,
        },
        update: {
          eventCount: { increment: counters.eventCount },
          pageViewCount: { increment: counters.pageViewCount },
          clickCount: { increment: counters.clickCount },
          loginCount: { increment: counters.loginCount },
        },
      });
      return;
    }

    const existingDaily = await tx.userDailyActivity.findUnique({
      where: {
        userId_day: { userId, day },
      },
      select: { id: true },
    });

    if (existingDaily) {
      await tx.userDailyActivity.update({
        where: { userId_day: { userId, day } },
        data: {
          lastSeenAt: eventTime,
          eventCount: { increment: counters.eventCount },
          pageViewCount: { increment: counters.pageViewCount },
          clickCount: { increment: counters.clickCount },
          loginCount: { increment: counters.loginCount },
        },
      });
    } else {
      await tx.userDailyActivity.create({
        data: {
          userId,
          day,
          firstSeenAt: eventTime,
          lastSeenAt: eventTime,
          eventCount: counters.eventCount,
          pageViewCount: counters.pageViewCount,
          clickCount: counters.clickCount,
          loginCount: counters.loginCount,
        },
      });
    }

    await tx.siteDailyActivity.upsert({
      where: { day },
      create: {
        day,
        uniqueUsers: existingDaily ? 0 : 1,
        eventCount: counters.eventCount,
        pageViewCount: counters.pageViewCount,
        clickCount: counters.clickCount,
        loginCount: counters.loginCount,
      },
      update: {
        uniqueUsers: { increment: existingDaily ? 0 : 1 },
        eventCount: { increment: counters.eventCount },
        pageViewCount: { increment: counters.pageViewCount },
        clickCount: { increment: counters.clickCount },
        loginCount: { increment: counters.loginCount },
      },
    });
  });
}

async function recordActivityBatch(events = [], fallback = {}) {
  if (!Array.isArray(events) || events.length === 0) return { accepted: 0 };

  const slice = events.slice(0, 100);
  for (const event of slice) {
    await recordSingleActivity({
      ...event,
      userId: event?.userId || fallback.userId || null,
      sessionId: event?.sessionId || fallback.sessionId || DEFAULT_SESSION,
    });
  }

  return { accepted: slice.length };
}

async function getSiteActivitySummary(days = 30) {
  const safeDays = Math.max(1, Math.min(180, Number(days) || 30));
  const now = new Date();
  const start = startOfUtcDay(new Date(now.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000));
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const [daily, topPages, totalUsers, loggedOnUsersTodayRows, uniqueVisitorsTodayRows, anonymousVisitorsTodayRows, clicksToday, uniqueVisitorsRangeRows] = await Promise.all([
    prisma.siteDailyActivity.findMany({
      where: { day: { gte: start } },
      orderBy: { day: 'asc' },
      select: {
        day: true,
        uniqueUsers: true,
        eventCount: true,
        pageViewCount: true,
        clickCount: true,
        loginCount: true,
      },
    }),
    prisma.userActivityEvent.groupBy({
      by: ['pagePath'],
      where: {
        eventType: 'page_view',
        occurredAt: { gte: start },
        pagePath: { not: null },
      },
      _count: { pagePath: true },
      orderBy: { _count: { pagePath: 'desc' } },
      take: 10,
    }),
    prisma.user.count(),
    prisma.userActivityEvent.findMany({
      where: {
        eventType: 'login',
        userId: { not: null },
        occurredAt: { gte: todayStart, lt: tomorrowStart },
      },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.userActivityEvent.findMany({
      where: {
        occurredAt: { gte: todayStart, lt: tomorrowStart },
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),
    prisma.userActivityEvent.findMany({
      where: {
        userId: null,
        occurredAt: { gte: todayStart, lt: tomorrowStart },
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),
    prisma.userActivityEvent.count({
      where: {
        eventType: 'click',
        occurredAt: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.userActivityEvent.findMany({
      where: {
        occurredAt: { gte: start },
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),
  ]);

  const todayKey = startOfUtcDay(now).getTime();
  const today = daily.find((d) => new Date(d.day).getTime() === todayKey) || {
    day: startOfUtcDay(now),
    uniqueUsers: 0,
    eventCount: 0,
    pageViewCount: 0,
    clickCount: 0,
    loginCount: 0,
  };

  const last7 = daily.slice(-7);
  const sum7 = last7.reduce(
    (acc, item) => {
      acc.uniqueUsers += item.uniqueUsers;
      acc.eventCount += item.eventCount;
      acc.pageViewCount += item.pageViewCount;
      acc.clickCount += item.clickCount;
      acc.loginCount += item.loginCount;
      return acc;
    },
    { uniqueUsers: 0, eventCount: 0, pageViewCount: 0, clickCount: 0, loginCount: 0 }
  );

  const divisor = Math.max(1, last7.length);

  return {
    days: safeDays,
    totalUsers,
    registeredUsers: totalUsers,
    loggedOnUsersToday: loggedOnUsersTodayRows.length,
    uniqueVisitorsToday: uniqueVisitorsTodayRows.length,
    uniqueAnonymousVisitorsToday: anonymousVisitorsTodayRows.length,
    uniqueVisitorsInRange: uniqueVisitorsRangeRows.length,
    clicksToday,
    today,
    last7Average: {
      uniqueUsers: Number((sum7.uniqueUsers / divisor).toFixed(2)),
      eventCount: Number((sum7.eventCount / divisor).toFixed(2)),
      pageViewCount: Number((sum7.pageViewCount / divisor).toFixed(2)),
      clickCount: Number((sum7.clickCount / divisor).toFixed(2)),
      loginCount: Number((sum7.loginCount / divisor).toFixed(2)),
    },
    daily,
    topPages: topPages.map((row) => ({
      pagePath: row.pagePath,
      views: row._count?.pagePath || 0,
    })),
  };
}

module.exports = {
  recordSingleActivity,
  recordActivityBatch,
  getSiteActivitySummary,
  startOfUtcDay,
};
