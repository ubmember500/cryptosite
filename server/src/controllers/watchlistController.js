const prisma = require('../utils/prisma');

/**
 * Get user's watchlist
 * Get all coins in user's watchlist from DB
 */
async function getWatchlist(req, res, next) {
  try {
    const userId = req.user.id;

    const watchlist = await prisma.watchlist.findMany({
      where: { userId },
      orderBy: { addedAt: 'desc' },
    });

    res.json({ watchlist });
  } catch (error) {
    next(error);
  }
}

/**
 * Add coin to watchlist
 * Check if exists, create if not, return watchlist item
 */
async function addToWatchlist(req, res, next) {
  try {
    const { coinId, coinSymbol } = req.body;
    const userId = req.user.id;

    if (!coinId || !coinSymbol) {
      return res.status(400).json({
        error: 'coinId and coinSymbol are required',
      });
    }

    // Check if already exists (using upsert to handle unique constraint)
    const watchlistItem = await prisma.watchlist.upsert({
      where: {
        userId_coinId: {
          userId,
          coinId,
        },
      },
      update: {
        // If exists, just return it
      },
      create: {
        userId,
        coinId,
        coinSymbol,
      },
    });

    res.status(201).json({ watchlistItem });
  } catch (error) {
    next(error);
  }
}

/**
 * Remove coin from watchlist
 * Delete watchlist item, verify ownership
 */
async function removeFromWatchlist(req, res, next) {
  try {
    const { coinId } = req.params;
    const userId = req.user.id;

    // Verify ownership and existence
    const watchlistItem = await prisma.watchlist.findUnique({
      where: {
        userId_coinId: {
          userId,
          coinId,
        },
      },
    });

    if (!watchlistItem) {
      return res.status(404).json({ error: 'Coin not found in watchlist' });
    }

    // Delete watchlist item
    await prisma.watchlist.delete({
      where: {
        userId_coinId: {
          userId,
          coinId,
        },
      },
    });

    res.json({ message: 'Coin removed from watchlist' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
};
