require('dotenv').config();
const prisma = require('./src/utils/prisma');

function startOfUtcDay(dateInput = new Date()) {
  const date = new Date(dateInput);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isMissingTableError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = String(error?.message || '').toLowerCase();
  return code === 'P2021' || code === 'P2022' || message.includes('does not exist');
}

function buildDailyFromEvents(events = [], start, now = new Date()) {
  const startDay = startOfUtcDay(start);
  const endDay = startOfUtcDay(now);
  const byDay = new Map();

  for (let cursor = new Date(startDay); cursor <= endDay; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    byDay.set(cursor.getTime(), {
      day: new Date(cursor),
      uniqueUsers: 0,
      eventCount: 0,
      pageViewCount: 0,
      clickCount: 0,
      loginCount: 0,
      _uniqueUserIds: new Set(),
    });
  }

  for (const event of events) {
    const key = startOfUtcDay(event.occurredAt).getTime();
    const row = byDay.get(key);
    if (!row) continue;

    row.eventCount += 1;
    if (event.eventType === 'page_view') row.pageViewCount += 1;
    if (event.eventType === 'click') row.clickCount += 1;
    if (event.eventType === 'login') row.loginCount += 1;
    if (event.userId) row._uniqueUserIds.add(event.userId);
  }

  return Array.from(byDay.values())
    .sort((a, b) => new Date(a.day) - new Date(b.day))
    .map((row) => ({
      day: row.day,
      uniqueUsers: row._uniqueUserIds.size,
      eventCount: row.eventCount,
      pageViewCount: row.pageViewCount,
      clickCount: row.clickCount,
      loginCount: row.loginCount,
    }));
}

async function main() {
  const days = Math.max(1, Math.min(180, Number(process.argv[2]) || 30));
  const now = new Date();
  const start = startOfUtcDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));

  const [dailyTable, fallbackEvents, topPages] = await Promise.all([
    prisma.siteDailyActivity
      .findMany({
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
      })
      .catch((err) => (isMissingTableError(err) ? null : Promise.reject(err))),
    prisma.userActivityEvent
      .findMany({
        where: { occurredAt: { gte: start } },
        select: { occurredAt: true, eventType: true, userId: true },
      })
      .catch((err) => (isMissingTableError(err) ? [] : Promise.reject(err))),
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
    }).catch((err) => (isMissingTableError(err) ? [] : Promise.reject(err))),
  ]);

  const daily = Array.isArray(dailyTable) ? dailyTable : buildDailyFromEvents(fallbackEvents, start, now);

  console.log(`\n📈 Activity report (${days}d)\n`);

  for (const row of daily) {
    const day = new Date(row.day).toISOString().slice(0, 10);
    console.log(
      `${day} | DAU=${row.uniqueUsers} | events=${row.eventCount} | views=${row.pageViewCount} | clicks=${row.clickCount} | logins=${row.loginCount}`
    );
  }

  console.log('\n🔥 Top pages by views\n');
  topPages.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.pagePath} — ${row._count?.pagePath || 0}`);
  });

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
