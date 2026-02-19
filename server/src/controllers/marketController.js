const priceService = require('../services/priceService');
const binanceService = require('../services/binanceService');
const bybitService = require('../services/bybitService');
const okxService = require('../services/okxService');
const gateService = require('../services/gateService');
const bitgetService = require('../services/bitgetService');
const mexcService = require('../services/mexcService');
const listingsService = require('../services/listingsService');
const binanceMarketMapService = require('../services/binanceMarketMapService');
const bybitMarketMapService = require('../services/bybitMarketMapService');

const BINANCE_FUTURES_BASE_URLS = [
  'https://fapi.binance.com/fapi/v1',
  'https://www.binance.com/fapi/v1',
];

const VALID_BINANCE_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);

async function fetchBinanceFuturesKlinesWithFallback(searchParams) {
  let lastError = null;

  for (const baseUrl of BINANCE_FUTURES_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}/klines?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 CryptoAlerts/1.0',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Non-JSON response (${contentType || 'unknown'}): ${text.slice(0, 120)}`);
      }

      const rows = await response.json();
      if (!Array.isArray(rows)) {
        throw new Error('Invalid Binance futures klines payload');
      }

      return {
        source: baseUrl,
        klines: rows,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('All Binance futures hosts failed');
}

function isTemporaryBinanceUpstreamError(error) {
  const status = error?.statusCode || error?.status || error?.response?.status;
  if ([429, 502, 503, 504].includes(status)) return true;

  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('rate limit exceeded') ||
    message.includes('temporarily unavailable') ||
    message.includes('server error') ||
    message.includes('restricted location')
  );
}

/**
 * Get top coins
 * Call priceService.fetchTopCoins, return cached/API result
 */
async function getCoins(req, res, next) {
  try {
    const coins = await priceService.fetchTopCoins();
    res.json({ coins });
  } catch (error) {
    next(error);
  }
}

/**
 * Get single coin details
 * Call priceService.fetchCoinPrice for single coin
 */
async function getCoin(req, res, next) {
  try {
    const { id } = req.params;
    const coin = await priceService.fetchCoinPrice(id);
    res.json({ coin });
  } catch (error) {
    next(error);
  }
}

/**
 * Search coins
 * Call priceService.searchCoins
 */
async function searchCoins(req, res, next) {
  try {
    const { q } = req.query;

    if (!q || q.trim() === '') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const results = await priceService.searchCoins(q.trim());
    res.json({ results });
  } catch (error) {
    next(error);
  }
}

/**
 * Get futures listings from official exchange listing metadata feeds.
 */
async function getListings(req, res, next) {
  try {
    const listings = await listingsService.syncAndGetListings();
    res.json({ listings });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Binance tokens (Futures or Spot) with NATR
 * Supports search filtering
 */
async function getBinanceTokens(req, res, next) {
  try {
    const { exchangeType, search, fresh } = req.query;

    // Validate exchangeType
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res
        .status(400)
        .json({
          error: 'Invalid exchangeType. Must be "futures" or "spot"',
        });
    }

    // Fetch tokens with NATR
    const forceFresh = fresh === '1' || fresh === 'true';
    let tokens = await binanceService.fetchTokensWithNATR(exchangeType, {
      forceFresh,
    });

    // Filter by search query if provided
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      tokens = tokens.filter(
        (token) =>
          token.symbol.toLowerCase().includes(searchLower) ||
          token.fullSymbol.toLowerCase().includes(searchLower)
      );
    }

    res.json({
      tokens,
      exchangeType,
      totalCount: tokens.length,
    });
  } catch (error) {
    if (isTemporaryBinanceUpstreamError(error)) {
      return res.json({
        tokens: [],
        exchangeType: req.query.exchangeType,
        totalCount: 0,
        upstreamUnavailable: true,
        warning: error.message,
      });
    }
    next(error);
  }
}

/**
 * Get Binance token details with NATR
 * @param {string} symbol - Token symbol (e.g., "BTCUSDT")
 * @param {string} exchangeType - "futures" | "spot"
 */
async function getBinanceTokenDetails(req, res, next) {
  try {
    const { symbol } = req.params;
    const { exchangeType } = req.query;

    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({ error: 'Invalid exchangeType' });
    }

    // Fetch token details + NATR
    const token = await binanceService.fetchTokenWithNATR(
      symbol,
      exchangeType
    );

    res.json({ token });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Binance klines (candlestick data) for charting
 * @param {string} symbol - Token symbol (e.g., "BTCUSDT")
 * @param {string} exchangeType - "futures" | "spot"
 * @param {string} interval - Time interval (default: "15m")
 * @param {number} limit - Number of candles (default: 500)
 */
async function getBinanceKlines(req, res, next) {
  // Performance monitoring: Track request start time
  const requestStartTime = Date.now();
  const requestStartISO = new Date(requestStartTime).toISOString();

  try {
    const { symbol, exchangeType, interval, limit, before } = req.query;

    // Log when /api/market/binance/klines endpoint is hit
    console.log('[Klines] Endpoint hit: /api/market/binance/klines');
    console.log('[Klines] Request parameters:', {
      symbol,
      exchangeType,
      interval,
      limit,
      before,
      startTime: requestStartISO,
    });

    // Validate required parameters
    if (!symbol) {
      console.log('[Klines] Validation failed: Symbol is required');
      return res.status(400).json({ error: 'Symbol is required' });
    }

    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      console.log('[Klines] Validation failed: Invalid exchangeType', {
        exchangeType,
      });
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }

    // Set defaults
    const klinesInterval = interval || '15m';
    const klinesLimit = limit ? parseInt(limit, 10) : 500;
    const beforeTimestamp = before ? parseInt(before, 10) : null;

    // Validate limit
    if (isNaN(klinesLimit) || klinesLimit < 1 || klinesLimit > 1000) {
      console.log('[Klines] Validation failed: Invalid limit', {
        limit: klinesLimit,
      });
      return res.status(400).json({
        error: 'Limit must be a number between 1 and 1000',
      });
    }

    if (before && (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0)) {
      return res.status(400).json({
        error: 'before must be a positive unix timestamp in milliseconds',
      });
    }

    // Log before calling service with timing
    const serviceCallStartTime = Date.now();
    const timeToServiceCall = ((serviceCallStartTime - requestStartTime) / 1000).toFixed(3);
    console.log('[Klines] Calling binanceService.fetchKlines:', {
      symbol,
      exchangeType,
      interval: klinesInterval,
      limit: klinesLimit,
      before: beforeTimestamp,
      timeToServiceCall: `${timeToServiceCall}s`,
      serviceCallStartTime: new Date(serviceCallStartTime).toISOString(),
    });

    // Fetch klines
    const klines = await binanceService.fetchKlines(
      symbol,
      exchangeType,
      klinesInterval,
      klinesLimit,
      { before: beforeTimestamp }
    );

    // Calculate service call duration
    const serviceCallEndTime = Date.now();
    const serviceCallDuration = ((serviceCallEndTime - serviceCallStartTime) / 1000).toFixed(3);

    // Verify response format
    if (!Array.isArray(klines)) {
      console.error('[Klines] ERROR: klines is not an array:', typeof klines);
      throw new Error('Invalid response format: klines must be an array');
    }

    // Verify kline structure (check first kline if available)
    if (klines.length > 0) {
      const firstKline = klines[0];
      const requiredFields = ['time', 'open', 'high', 'low', 'close', 'volume'];
      const missingFields = requiredFields.filter(
        (field) => !(field in firstKline)
      );

      if (missingFields.length > 0) {
        console.error(
          '[Klines] ERROR: Missing required fields in kline:',
          missingFields
        );
        throw new Error(
          `Invalid kline format: missing fields ${missingFields.join(', ')}`
        );
      }
    }

    // Calculate total request duration
    const responseSendTime = Date.now();
    const totalDuration = ((responseSendTime - requestStartTime) / 1000).toFixed(3);
    const serviceCallDurationMs = serviceCallEndTime - serviceCallStartTime;
    const totalDurationMs = responseSendTime - requestStartTime;

    // Log after receiving klines with performance metrics
    console.log('[Klines] Returning:', {
      count: klines.length,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
      serviceCallDuration: `${serviceCallDuration}s`,
      totalDuration: `${totalDuration}s`,
      responseSendTime: new Date(responseSendTime).toISOString(),
    });

    // Performance warning for slow requests (> 3 seconds)
    if (totalDurationMs > 3000) {
      console.warn(
        `[Klines] ⚠️  Performance warning: Request took ${totalDuration}s (> 3s threshold)`,
        {
          symbol: symbol.toUpperCase(),
          exchangeType,
          interval: klinesInterval,
          limit: klinesLimit,
          serviceCallDuration: `${serviceCallDuration}s`,
          totalDuration: `${totalDuration}s`,
          breakdown: {
            timeToServiceCall: `${timeToServiceCall}s`,
            serviceCallDuration: `${serviceCallDuration}s`,
            timeAfterServiceCall: `${((responseSendTime - serviceCallEndTime) / 1000).toFixed(3)}s`,
          },
        }
      );
    }

    // Return response
    const response = {
      klines,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
    };

    // Log response before sending
    console.log('[Klines] Sending response:', {
      klinesCount: klines.length,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
      responseFormat: {
        hasKlines: Array.isArray(klines),
        klinesIsArray: Array.isArray(klines),
        klinesLength: klines.length,
        hasSymbol: !!response.symbol,
        hasExchangeType: !!response.exchangeType,
        hasInterval: !!response.interval,
      },
      sampleKline: klines.length > 0 ? {
        time: klines[0].time,
        open: klines[0].open,
        high: klines[0].high,
        low: klines[0].low,
        close: klines[0].close,
        volume: klines[0].volume,
        hasAllFields: ['time', 'open', 'high', 'low', 'close', 'volume'].every(
          (field) => field in klines[0]
        ),
      } : null,
    });

    res.json(response);
  } catch (error) {
    if (isTemporaryBinanceUpstreamError(error)) {
      return res.json({
        klines: [],
        symbol: String(req.query.symbol || '').toUpperCase(),
        exchangeType: req.query.exchangeType,
        interval: req.query.interval || '15m',
        upstreamUnavailable: true,
        warning: error.message,
      });
    }
    // Calculate error duration
    const errorTime = Date.now();
    const errorDuration = ((errorTime - requestStartTime) / 1000).toFixed(3);

    // Log full error details with timing
    console.error('[Klines] Error in getBinanceKlines:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      duration: `${errorDuration}s`,
      errorTime: new Date(errorTime).toISOString(),
    });

    next(error);
  }
}

async function getBinanceFuturesKlinesProxy(req, res) {
  try {
    const symbol = String(req.query?.symbol || '').trim().toUpperCase();
    const interval = String(req.query?.interval || '15m').trim();
    const limit = Number(req.query?.limit || 500);
    const endTimeRaw = req.query?.endTime;

    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    if (!VALID_BINANCE_INTERVALS.has(interval)) {
      return res.status(400).json({ error: 'Invalid interval' });
    }

    if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'Invalid limit' });
    }

    const searchParams = new URLSearchParams({
      symbol,
      interval,
      limit: String(Math.floor(limit)),
    });

    if (endTimeRaw !== undefined && endTimeRaw !== null && endTimeRaw !== '') {
      const endTime = Number(endTimeRaw);
      if (!Number.isFinite(endTime) || endTime <= 0) {
        return res.status(400).json({ error: 'Invalid endTime' });
      }
      searchParams.set('endTime', String(Math.floor(endTime)));
    }

    const result = await fetchBinanceFuturesKlinesWithFallback(searchParams);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({
      error: error?.message || 'Failed to fetch Binance futures klines',
    });
  }
}

/**
 * Get Binance futures market-map ranking based on live 5m range % activity.
 * Query params:
 * - limit: optional number of rows to return
 */
async function getBinanceMarketMapRanking(req, res, next) {
  try {
    const { limit } = req.query;
    const result = binanceMarketMapService.getRanking({ limit });

    res.json({
      exchange: 'binance',
      exchangeType: 'futures',
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Bybit futures market-map ranking based on live 5m range % activity.
 * Query params:
 * - limit: optional number of rows to return
 */
async function getBybitMarketMapRanking(req, res, next) {
  try {
    const { limit } = req.query;
    const result = bybitMarketMapService.getRanking({ limit });

    res.json({
      exchange: 'bybit',
      exchangeType: 'futures',
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Bybit tokens (Futures or Spot) with NATR. Same response shape as Binance.
 */
async function getBybitTokens(req, res, next) {
  try {
    const { exchangeType, search } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    let tokens = await bybitService.fetchTokensWithNATR(exchangeType);
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      tokens = tokens.filter(
        (token) =>
          token.symbol.toLowerCase().includes(searchLower) ||
          token.fullSymbol.toLowerCase().includes(searchLower)
      );
    }
    res.json({
      tokens,
      exchangeType,
      totalCount: tokens.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Bybit token details with NATR
 */
async function getBybitTokenDetails(req, res, next) {
  try {
    const { symbol } = req.params;
    const { exchangeType } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({ error: 'Invalid exchangeType' });
    }
    const token = await bybitService.fetchTokenWithNATR(symbol, exchangeType);
    res.json({ token });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Bybit klines for charting. Same response shape as Binance.
 */
async function getBybitKlines(req, res, next) {
  try {
    const { symbol, exchangeType, interval, limit, before } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    const klinesInterval = interval || '15m';
    const klinesLimit = limit ? parseInt(limit, 10) : 500;
    const beforeTimestamp = before ? parseInt(before, 10) : null;
    if (isNaN(klinesLimit) || klinesLimit < 1 || klinesLimit > 1000) {
      return res.status(400).json({
        error: 'Limit must be a number between 1 and 1000',
      });
    }
    if (before && (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0)) {
      return res.status(400).json({
        error: 'before must be a positive unix timestamp in milliseconds',
      });
    }
    const klines = await bybitService.fetchKlines(
      symbol,
      exchangeType,
      klinesInterval,
      klinesLimit,
      { before: beforeTimestamp }
    );
    if (!Array.isArray(klines)) {
      throw new Error('Invalid response format: klines must be an array');
    }
    res.json({
      klines,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get OKX tokens (Futures or Spot) with NATR. Same response shape as Binance.
 */
async function getOkxTokens(req, res, next) {
  try {
    const { exchangeType, search } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    let tokens = await okxService.fetchTokensWithNATR(exchangeType);
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      tokens = tokens.filter(
        (token) =>
          token.symbol.toLowerCase().includes(searchLower) ||
          token.fullSymbol.toLowerCase().includes(searchLower)
      );
    }
    res.json({
      tokens,
      exchangeType,
      totalCount: tokens.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get OKX token details with NATR
 */
async function getOkxTokenDetails(req, res, next) {
  try {
    const { symbol } = req.params;
    const { exchangeType } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({ error: 'Invalid exchangeType' });
    }
    const token = await okxService.fetchTokenWithNATR(symbol, exchangeType);
    res.json({ token });
  } catch (error) {
    next(error);
  }
}

/**
 * Get OKX klines for charting. Same response shape as Binance.
 */
async function getOkxKlines(req, res, next) {
  try {
    const { symbol, exchangeType, interval, limit, before } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    const klinesInterval = interval || '15m';
    const klinesLimit = limit ? parseInt(limit, 10) : 500;
    const beforeTimestamp = before ? parseInt(before, 10) : null;
    if (isNaN(klinesLimit) || klinesLimit < 1 || klinesLimit > 1000) {
      return res.status(400).json({
        error: 'Limit must be a number between 1 and 1000',
      });
    }
    if (before && (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0)) {
      return res.status(400).json({
        error: 'before must be a positive unix timestamp in milliseconds',
      });
    }
    const klines = await okxService.fetchKlines(
      symbol,
      exchangeType,
      klinesInterval,
      klinesLimit,
      { before: beforeTimestamp }
    );
    if (!Array.isArray(klines)) {
      throw new Error('Invalid response format: klines must be an array');
    }
    res.json({
      klines,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Gate.io tokens (Futures or Spot) with NATR. Same response shape as Binance.
 */
async function getGateTokens(req, res, next) {
  try {
    const { exchangeType, search } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    let tokens = await gateService.fetchTokensWithNATR(exchangeType);
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      tokens = tokens.filter(
        (token) =>
          token.symbol.toLowerCase().includes(searchLower) ||
          token.fullSymbol.toLowerCase().includes(searchLower)
      );
    }
    res.json({
      tokens,
      exchangeType,
      totalCount: tokens.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Gate.io token details with NATR
 */
async function getGateTokenDetails(req, res, next) {
  try {
    const { symbol } = req.params;
    const { exchangeType } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({ error: 'Invalid exchangeType' });
    }
    const token = await gateService.fetchTokenWithNATR(symbol, exchangeType);
    res.json({ token });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Gate.io klines for charting. Same response shape as Binance.
 */
async function getGateKlines(req, res, next) {
  try {
    const { symbol, exchangeType, interval, limit, before } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    const klinesInterval = interval || '15m';
    const klinesLimit = limit ? parseInt(limit, 10) : 500;
    const beforeTimestamp = before ? parseInt(before, 10) : null;
    if (isNaN(klinesLimit) || klinesLimit < 1 || klinesLimit > 1000) {
      return res.status(400).json({
        error: 'Limit must be a number between 1 and 1000',
      });
    }
    if (before && (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0)) {
      return res.status(400).json({
        error: 'before must be a positive unix timestamp in milliseconds',
      });
    }
    const klines = await gateService.fetchKlines(
      symbol,
      exchangeType,
      klinesInterval,
      klinesLimit,
      { before: beforeTimestamp }
    );
    if (!Array.isArray(klines)) {
      throw new Error('Invalid response format: klines must be an array');
    }
    res.json({
      klines,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Bitget tokens (Futures or Spot) with NATR. Same response shape as Binance.
 */
async function getBitgetTokens(req, res, next) {
  try {
    const { exchangeType, search } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    let tokens = await bitgetService.fetchTokensWithNATR(exchangeType);
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      tokens = tokens.filter(
        (token) =>
          token.symbol.toLowerCase().includes(searchLower) ||
          token.fullSymbol.toLowerCase().includes(searchLower)
      );
    }
    res.json({
      tokens,
      exchangeType,
      totalCount: tokens.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Bitget token details with NATR
 */
async function getBitgetTokenDetails(req, res, next) {
  try {
    const { symbol } = req.params;
    const { exchangeType } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({ error: 'Invalid exchangeType' });
    }
    const token = await bitgetService.fetchTokenWithNATR(symbol, exchangeType);
    res.json({ token });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Bitget klines for charting. Same response shape as Binance.
 */
async function getBitgetKlines(req, res, next) {
  try {
    const { symbol, exchangeType, interval, limit, before } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    const klinesInterval = interval || '15m';
    const klinesLimit = limit ? parseInt(limit, 10) : 500;
    const beforeTimestamp = before ? parseInt(before, 10) : null;
    if (isNaN(klinesLimit) || klinesLimit < 1 || klinesLimit > 1000) {
      return res.status(400).json({
        error: 'Limit must be a number between 1 and 1000',
      });
    }
    if (before && (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0)) {
      return res.status(400).json({
        error: 'before must be a positive unix timestamp in milliseconds',
      });
    }
    const klines = await bitgetService.fetchKlines(
      symbol,
      exchangeType,
      klinesInterval,
      klinesLimit,
      { before: beforeTimestamp }
    );
    if (!Array.isArray(klines)) {
      throw new Error('Invalid response format: klines must be an array');
    }
    res.json({
      klines,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get MEXC tokens (Futures or Spot) with NATR. Same response shape as Binance.
 */
async function getMexcTokens(req, res, next) {
  try {
    const { exchangeType, search } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    let tokens = await mexcService.fetchTokensWithNATR(exchangeType);
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      tokens = tokens.filter(
        (token) =>
          token.symbol.toLowerCase().includes(searchLower) ||
          token.fullSymbol.toLowerCase().includes(searchLower)
      );
    }
    res.json({
      tokens,
      exchangeType,
      totalCount: tokens.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get MEXC token details with NATR
 */
async function getMexcTokenDetails(req, res, next) {
  try {
    const { symbol } = req.params;
    const { exchangeType } = req.query;
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({ error: 'Invalid exchangeType' });
    }
    const token = await mexcService.fetchTokenWithNATR(symbol, exchangeType);
    res.json({ token });
  } catch (error) {
    next(error);
  }
}

/**
 * Get MEXC klines for charting. Same response shape as Binance.
 */
async function getMexcKlines(req, res, next) {
  try {
    const { symbol, exchangeType, interval, limit, before } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    if (!exchangeType || !['futures', 'spot'].includes(exchangeType)) {
      return res.status(400).json({
        error: 'Invalid exchangeType. Must be "futures" or "spot"',
      });
    }
    const klinesInterval = interval || '15m';
    const klinesLimit = limit ? parseInt(limit, 10) : 500;
    const beforeTimestamp = before ? parseInt(before, 10) : null;
    if (isNaN(klinesLimit) || klinesLimit < 1 || klinesLimit > 1000) {
      return res.status(400).json({
        error: 'Limit must be a number between 1 and 1000',
      });
    }
    if (before && (!Number.isFinite(beforeTimestamp) || beforeTimestamp <= 0)) {
      return res.status(400).json({
        error: 'before must be a positive unix timestamp in milliseconds',
      });
    }
    const klines = await mexcService.fetchKlines(
      symbol,
      exchangeType,
      klinesInterval,
      klinesLimit,
      { before: beforeTimestamp }
    );
    if (!Array.isArray(klines)) {
      throw new Error('Invalid response format: klines must be an array');
    }
    res.json({
      klines,
      symbol: symbol.toUpperCase(),
      exchangeType,
      interval: klinesInterval,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCoins,
  getCoin,
  searchCoins,
  getListings,
  getBinanceFuturesKlinesProxy,
  getBinanceTokens,
  getBinanceTokenDetails,
  getBinanceKlines,
  getBinanceMarketMapRanking,
  getBybitMarketMapRanking,
  getBybitTokens,
  getBybitTokenDetails,
  getBybitKlines,
  getOkxTokens,
  getOkxTokenDetails,
  getOkxKlines,
  getGateTokens,
  getGateTokenDetails,
  getGateKlines,
  getBitgetTokens,
  getBitgetTokenDetails,
  getBitgetKlines,
  getMexcTokens,
  getMexcTokenDetails,
  getMexcKlines,
};
