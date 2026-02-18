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
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
	throw new Error('[prisma] DATABASE_URL is required. Use an external PostgreSQL URL (Neon/Supabase/Render Postgres).');
}

const prisma = new PrismaClient();

module.exports = prisma;
