/**
 * Vercel Serverless Function — Binance Order Book Depth Proxy
 *
 * Runs from Singapore (sin1) to bypass Binance geo-blocks and IP bans.
 * The backend server (Render) cannot reach Binance directly (HTTP 418).
 *
 * Two modes:
 *
 *  1. Symbol discovery:
 *     GET /api/binance-depth?symbolsOnly=1&market=futures
 *     → Returns ALL USDT symbols sorted by 24h volume.
 *       No depth data fetched. Used by server to build its symbol list.
 *
 *  2. Depth batch:
 *     GET /api/binance-depth?symbols=BTCUSDT,ETHUSDT,...&limit=50&market=futures
 *     → Fetches order books for the given symbols in parallel.
 *       Server splits 640+ symbols into batches of ~150 and fires
 *       multiple parallel calls to this function.
 *
 * Returns: { market, books, symbols, symbolCount, elapsed, ts }
 *
 * Performance: Each batch of 150 symbols with limit=50 completes in ~300ms
 *   from Singapore. Well within Vercel's 10s function timeout.
 */

const FUTURES_BASES = [
  'https://fapi.binance.com/fapi/v1',
  'https://fapi1.binance.com/fapi/v1',
  'https://fapi2.binance.com/fapi/v1',
];

const SPOT_BASES = [
  'https://data-api.binance.vision/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api.binance.com/api/v3',
];

// Hardcoded fallback — used when ticker fetch times out
const FALLBACK_FUTURES = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','SUIUSDT','BNBUSDT',
  'ADAUSDT','LINKUSDT','AVAXUSDT','DOTUSDT','TRXUSDT','LTCUSDT','NEARUSDT',
  'PEPEUSDT','SHIBUSDT','ARBUSDT','OPUSDT','APTUSDT','UNIUSDT','FILUSDT',
  'BCHUSDT','INJUSDT','WLDUSDT','FETUSDT','JUPUSDT','ONDOUSDT','STXUSDT',
  'SEIUSDT','TIAUSDT','ICPUSDT','AAVEUSDT','RENDERUSDT','MKRUSDT','FLOKIUSDT',
  'GRTUSDT','THETAUSDT','IMXUSDT','SNXUSDT','MATICUSDT','TONUSDT','KASUSDT',
  'ENAUSDT','PENDLEUSDT','RUNEUSDT','LDOUSDT','HBARUSDT','VETUSDT','ALGOUSDT',
  'XLMUSDT','ATOMUSDT','FTMUSDT','WIFUSDT','XAGUSDT','ASTERUSDT','HOMEUSDT',
  'XMRUSDT','BONKUSDT','GALAUSDT','SANDUSDT','MANAUSDT','AXSUSDT','APEUSDT',
  'ZECUSDT','ETCUSDT','XAUUSDT','HYPEUSDT','COMPUSDT','CRVUSDT','DYDXUSDT',
];

const FALLBACK_SPOT = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT',
  'TRXUSDT','SUIUSDT','LINKUSDT','AVAXUSDT','DOTUSDT','SHIBUSDT','PEPEUSDT',
  'NEARUSDT','LTCUSDT','BCHUSDT','UNIUSDT','APTUSDT','ARBUSDT','OPUSDT',
  'FILUSDT','INJUSDT','FETUSDT','WLDUSDT','JUPUSDT','ONDOUSDT','STXUSDT',
  'SEIUSDT','TIAUSDT','ICPUSDT','AAVEUSDT','RENDERUSDT','MKRUSDT','FLOKIUSDT',
  'GRTUSDT','THETAUSDT','IMXUSDT','SNXUSDT','MATICUSDT','TONUSDT','KASUSDT',
  'ENAUSDT','PENDLEUSDT','RUNEUSDT','LDOUSDT','HBARUSDT','VETUSDT','ALGOUSDT',
  'XLMUSDT','ATOMUSDT','FTMUSDT','WIFUSDT','BONKUSDT','GALAUSDT','SANDUSDT',
  'ZECUSDT','ETCUSDT','XAUUSDT','HYPEUSDT','COMPUSDT','CRVUSDT','DYDXUSDT',
];

/**
 * Fetch JSON from the first working base URL.
 */
/**
 * Fetch JSON from the first working base URL.
 * Collects errors for diagnostics.
 */
async function fetchJSON(bases, path, timeout = 5000, errors = []) {
  for (const base of bases) {
    const url = `${base}${path}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 CryptoAlerts/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        errors.push(`${url} → HTTP ${res.status}: ${text.slice(0, 120)}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      errors.push(`${url} → ${e.name}: ${e.message}`);
      continue;
    }
  }
  return null;
}

/**
 * Resolve which symbols to scan. Priority:
 *  1. Explicit `symbols` query param (fastest — no network call)
 *  2. Dynamic ticker fetch (works well for futures ~300 symbols)
 *  3. Hardcoded fallback (ensures function always returns data)
 */
async function resolveSymbols(market, bases, top, errors) {
  // Try dynamic fetch with a tight timeout (4s leaves 6s for depth)
  const tickers = await fetchJSON(bases, '/ticker/24hr', 4000, errors);

  if (tickers && Array.isArray(tickers) && tickers.length > 0) {
    const ranked = tickers
      .filter(t => t.symbol && t.symbol.endsWith('USDT'))
      .map(t => ({ symbol: t.symbol, vol: parseFloat(t.quoteVolume || 0) }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, top)
      .map(t => t.symbol);

    if (ranked.length > 0) return { symbols: ranked, source: 'live' };
  }

  // Fallback to hardcoded list
  const fallback = market === 'spot' ? FALLBACK_SPOT : FALLBACK_FUTURES;
  return { symbols: fallback.slice(0, top), source: 'fallback' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const market = (req.query.market || 'futures').toLowerCase();

  if (market !== 'futures' && market !== 'spot') {
    return res.status(400).json({ error: 'market must be futures or spot' });
  }

  const bases = market === 'spot' ? SPOT_BASES : FUTURES_BASES;
  const startTime = Date.now();
  const debug = req.query.debug === '1';
  const errors = [];

  // ═══ Mode 1: Symbol discovery (no depth) ═══
  // GET /api/binance-depth?symbolsOnly=1&market=futures
  // Returns all USDT symbols sorted by 24h volume.
  if (req.query.symbolsOnly === '1') {
    const tickers = await fetchJSON(bases, '/ticker/24hr', 6000, errors);

    let symbols = [];
    let source = 'fallback';

    if (tickers && Array.isArray(tickers) && tickers.length > 0) {
      symbols = tickers
        .filter(t => t.symbol && t.symbol.endsWith('USDT'))
        .map(t => ({ symbol: t.symbol, vol: parseFloat(t.quoteVolume || 0) }))
        .sort((a, b) => b.vol - a.vol)
        .map(t => t.symbol);
      source = 'live';
    }

    if (symbols.length === 0) {
      symbols = market === 'spot' ? [...FALLBACK_SPOT] : [...FALLBACK_FUTURES];
      source = 'fallback';
    }

    return res.status(200).json({
      market,
      symbols,
      symbolCount: symbols.length,
      source,
      elapsed: Date.now() - startTime,
      ts: Date.now(),
      ...(debug ? { errors: errors.slice(0, 20) } : {}),
    });
  }

  // ═══ Mode 2: Depth batch ═══
  // GET /api/binance-depth?symbols=BTCUSDT,ETHUSDT,...&limit=50&market=futures
  // Fetches order books for the specified symbols.
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 5), 500);
  const symbolsParam = req.query.symbols;

  let symbols, symbolSource;

  if (symbolsParam && symbolsParam.length > 0) {
    // Explicit symbol list — primary path for multi-batch scanning
    symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    symbolSource = 'param';
  } else {
    // Legacy fallback: auto-discover top N symbols
    const top = Math.min(Math.max(parseInt(req.query.top) || 200, 1), 1000);
    const resolved = await resolveSymbols(market, bases, top, errors);
    symbols = resolved.symbols;
    symbolSource = resolved.source;
  }

  if (symbols.length === 0) {
    return res.status(200).json({ market, books: {}, symbols: [], symbolCount: 0, ts: Date.now() });
  }

  // Fetch all order books in sub-batches of 30 to avoid overwhelming
  // Binance and causing silent drops under load
  const books = {};
  const SUB_BATCH = 30;

  for (let i = 0; i < symbols.length; i += SUB_BATCH) {
    const batch = symbols.slice(i, i + SUB_BATCH);
    await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchJSON(bases, `/depth?symbol=${symbol}&limit=${limit}`, 5000, errors);
        if (data && (data.bids || data.asks)) {
          books[symbol] = { bids: data.bids || [], asks: data.asks || [] };
        }
      })
    );
  }

  const elapsed = Date.now() - startTime;

  const result = {
    market,
    books,
    symbols,
    symbolSource,
    symbolCount: Object.keys(books).length,
    elapsed,
    ts: Date.now(),
  };

  if (debug) {
    result.errors = errors.slice(0, 30);
  }

  return res.status(200).json(result);
}
