require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const count = await prisma.user.count();
  console.log('Users:', count);
  const users = await prisma.user.findMany({ select: { id: true, email: true, username: true, createdAt: true } });
  users.forEach((u, i) => console.log(`${i + 1}. ${u.username} (${u.email})`));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
