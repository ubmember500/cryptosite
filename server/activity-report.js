require('dotenv').config();
const prisma = require('./src/utils/prisma');

function startOfUtcDay(dateInput = new Date()) {
  const date = new Date(dateInput);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function main() {
  const days = Math.max(1, Math.min(180, Number(process.argv[2]) || 30));
  const now = new Date();
  const start = startOfUtcDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));

  const [daily, topPages] = await Promise.all([
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
  ]);

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
