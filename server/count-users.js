require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error('DATABASE_URL is required');
}

const adapter = new PrismaPg({ connectionString: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const count = await prisma.user.count();
  console.log('Users:', count);
  const users = await prisma.user.findMany({ select: { id: true, email: true, username: true, createdAt: true } });
  users.forEach((u, i) => console.log(`${i + 1}. ${u.username} (${u.email})`));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
