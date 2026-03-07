/**
 * Token Settings Controller
 *
 * CRUD for per-user, per-token, per-exchange+market min wall size overrides.
 * Used by the "Individual Settings" modal in the density screener.
 */
const prisma = require('../utils/prisma');

// Valid exchanges and markets
const VALID_EXCHANGES = ['binance', 'bybit', 'okx'];
const VALID_MARKETS = ['futures', 'spot'];

/**
 * GET /api/density-screener/token-settings
 *
 * Returns all token settings for the authenticated user.
 * Response: { settings: [{ ticker, exchange, market, minWallSize }, ...] }
 */
async function getTokenSettings(req, res, next) {
  try {
    const userId = req.user.id;

    const settings = await prisma.userTokenSetting.findMany({
      where: { userId },
      select: {
        id: true,
        ticker: true,
        exchange: true,
        market: true,
        minWallSize: true,
      },
      orderBy: [{ ticker: 'asc' }, { exchange: 'asc' }, { market: 'asc' }],
    });

    res.json({ settings });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/density-screener/token-settings
 *
 * Upsert a single token setting (create or update).
 * Body: { ticker, exchange, market, minWallSize }
 */
async function upsertTokenSetting(req, res, next) {
  try {
    const userId = req.user.id;
    let { ticker, exchange, market, minWallSize } = req.body;

    // Validate
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'ticker is required (e.g. "BTC")' });
    }
    ticker = ticker.trim().toUpperCase();

    if (!VALID_EXCHANGES.includes(exchange)) {
      return res.status(400).json({ error: `exchange must be one of: ${VALID_EXCHANGES.join(', ')}` });
    }
    if (!VALID_MARKETS.includes(market)) {
      return res.status(400).json({ error: `market must be one of: ${VALID_MARKETS.join(', ')}` });
    }

    minWallSize = parseInt(minWallSize, 10);
    if (isNaN(minWallSize) || minWallSize < 0) {
      return res.status(400).json({ error: 'minWallSize must be a non-negative integer (USD)' });
    }

    const setting = await prisma.userTokenSetting.upsert({
      where: {
        userId_ticker_exchange_market: { userId, ticker, exchange, market },
      },
      update: { minWallSize },
      create: { userId, ticker, exchange, market, minWallSize },
    });

    res.json({ setting });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/density-screener/token-settings/batch
 *
 * Upsert multiple token settings at once.
 * Body: { settings: [{ ticker, exchange, market, minWallSize }, ...] }
 * Max 500 settings per request.
 */
async function batchUpsertTokenSettings(req, res, next) {
  try {
    const userId = req.user.id;
    const { settings } = req.body;

    if (!Array.isArray(settings) || settings.length === 0) {
      return res.status(400).json({ error: 'settings must be a non-empty array' });
    }
    if (settings.length > 500) {
      return res.status(400).json({ error: 'Max 500 settings per batch' });
    }

    const results = [];

    // Use a transaction for atomic batch upsert
    await prisma.$transaction(async (tx) => {
      for (const s of settings) {
        let { ticker, exchange, market, minWallSize } = s;
        if (!ticker || !exchange || !market) continue;

        ticker = ticker.trim().toUpperCase();
        if (!VALID_EXCHANGES.includes(exchange)) continue;
        if (!VALID_MARKETS.includes(market)) continue;

        minWallSize = parseInt(minWallSize, 10);
        if (isNaN(minWallSize) || minWallSize < 0) continue;

        const setting = await tx.userTokenSetting.upsert({
          where: {
            userId_ticker_exchange_market: { userId, ticker, exchange, market },
          },
          update: { minWallSize },
          create: { userId, ticker, exchange, market, minWallSize },
        });
        results.push(setting);
      }
    });

    res.json({ settings: results, count: results.length });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/density-screener/token-settings/:id
 *
 * Delete a specific token setting by ID.
 */
async function deleteTokenSetting(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Verify ownership
    const existing = await prisma.userTokenSetting.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    await prisma.userTokenSetting.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/density-screener/token-settings
 *
 * Delete ALL token settings for the authenticated user (reset).
 */
async function resetTokenSettings(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await prisma.userTokenSetting.deleteMany({ where: { userId } });
    res.json({ success: true, deleted: result.count });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTokenSettings,
  upsertTokenSetting,
  batchUpsertTokenSettings,
  deleteTokenSetting,
  resetTokenSettings,
};
