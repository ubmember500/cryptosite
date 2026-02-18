const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { execSync } = require('node:child_process');
require('dotenv').config();

function loadPrismaClient() {
	try {
		return require('@prisma/client');
	} catch (error) {
		const missingGeneratedClient =
			error &&
			error.code === 'MODULE_NOT_FOUND' &&
			String(error.message || '').includes('.prisma/client/default');

		if (!missingGeneratedClient) {
			throw error;
		}

		execSync('npx prisma generate', { stdio: 'inherit' });
		return require('@prisma/client');
	}
}

const { PrismaClient } = loadPrismaClient();
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
