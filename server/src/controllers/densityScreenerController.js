/**
 * Density Screener Controller
 * 
 * All handlers read from the in-memory DensityScannerService singleton.
 * No database queries, no exchange API calls — pure CPU filtering.
 */
const densityScannerService = require('../services/densityScanner');

/**
 * GET /api/density-screener/walls
 * 
 * Main data endpoint — returns filtered, sorted walls.
 * 
 * Query params:
 *   exchanges   — comma-separated: binance,bybit,okx (default: all)
 *   markets     — comma-separated: futures,spot (default: futures)
 *   minVolume   — minimum wall volumeUSD (default: 100000)
 *   maxVolume   — maximum wall volumeUSD (optional, no default)
 *   side        — BID, ASK, or Both (default: Both)
 *   symbols     — comma-separated symbol filter, e.g. BTCUSDT,ETHUSDT (optional — all if empty)
 *   minAge      — minimum wall age in seconds (default: 0)
 *   maxDistFromMid — maximum |percentFromMid| (default: 10)
 *   depth       — not used for filtering (scanning uses server default), but kept for compatibility
 *   sort        — field to sort by: volumeUSD, wallAgeMs, percentFromMid (default: volumeUSD)
 *   order       — asc or desc (default: desc)
 *   limit       — max results (default: 500, max 2000)
 */
async function getWalls(req, res, next) {
  try {
    // Parse query params with defaults
    let exchangeFilter = req.query.exchanges
      ? req.query.exchanges.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      : ['binance', 'bybit', 'okx'];
    if (exchangeFilter.length === 0) exchangeFilter = ['binance', 'bybit', 'okx'];
    
    let marketFilter = req.query.markets
      ? req.query.markets.split(',').map(m => m.trim().toLowerCase()).filter(Boolean)
      : ['futures'];
    if (marketFilter.length === 0) marketFilter = ['futures', 'spot'];
    
    const minVolume = parseFloat(req.query.minVolume) || 100000;
    const maxVolume = req.query.maxVolume ? parseFloat(req.query.maxVolume) : Infinity;
    
    const sideFilter = (req.query.side || 'Both').toUpperCase();
    
    const symbolFilter = req.query.symbols
      ? req.query.symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
    
    const minAgeSeconds = parseInt(req.query.minAge) || 0;
    const minAgeMs = minAgeSeconds * 1000;
    
    const maxDistFromMid = parseFloat(req.query.maxDistFromMid) || 10;
    
    const sortField = req.query.sort || 'volumeUSD';
    const sortOrder = (req.query.order || 'desc').toLowerCase();
    
    let limit = parseInt(req.query.limit) || 500;
    if (limit > 2000) limit = 2000;
    if (limit < 1) limit = 1;

    // Get all walls from the in-memory store
    let walls = densityScannerService.getWalls();

    // Apply filters in sequence (most selective first for performance)
    walls = walls.filter(w => {
      // Exchange filter
      if (!exchangeFilter.includes(w.exchange)) return false;
      
      // Market filter
      if (!marketFilter.includes(w.market)) return false;
      
      // Volume filter
      if (w.volumeUSD < minVolume || w.volumeUSD > maxVolume) return false;
      
      // Side filter
      if (sideFilter !== 'BOTH' && w.side !== sideFilter) return false;
      
      // Symbol filter (if provided)
      if (symbolFilter.length > 0 && !symbolFilter.includes(w.symbol)) return false;
      
      // Wall age filter
      if (minAgeMs > 0 && w.wallAgeMs < minAgeMs) return false;
      
      // Distance from mid filter
      if (Math.abs(w.percentFromMid) > maxDistFromMid) return false;
      
      return true;
    });

    // Sort
    const validSortFields = ['volumeUSD', 'wallAgeMs', 'percentFromMid', 'price'];
    const actualSortField = validSortFields.includes(sortField) ? sortField : 'volumeUSD';
    
    walls.sort((a, b) => {
      const aVal = actualSortField === 'percentFromMid' ? Math.abs(a[actualSortField]) : a[actualSortField];
      const bVal = actualSortField === 'percentFromMid' ? Math.abs(b[actualSortField]) : b[actualSortField];
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Limit
    walls = walls.slice(0, limit);

    res.json({
      walls,
      meta: {
        total: walls.length,
        timestamp: new Date().toISOString(),
        filters: {
          exchanges: exchangeFilter,
          markets: marketFilter,
          minVolume,
          side: sideFilter,
          symbols: symbolFilter,
          minAgeSeconds,
          maxDistFromMid,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/density-screener/symbols
 * 
 * Returns available symbols per exchange+market.
 * Used by the frontend token selector/autocomplete.
 */
async function getSymbols(req, res, next) {
  try {
    const symbols = densityScannerService.getAvailableSymbols();
    res.json({ symbols });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/density-screener/status
 * 
 * Scanner health endpoint — no auth required.
 * Shows per-exchange scan status, timing, wall counts.
 */
async function getStatus(req, res, next) {
  try {
    const status = densityScannerService.getStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWalls,
  getSymbols,
  getStatus,
};
