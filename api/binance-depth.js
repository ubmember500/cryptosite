/**
 * Vercel Serverless Function — Binance Order Book Depth Proxy
 *
 * The backend server (Render) cannot reach Binance REST APIs directly
 * because Binance blocks cloud-provider IP ranges (HTTP 418).
 * This Vercel function acts as a proxy: Render calls here, this function
 * fetches from Binance (Vercel IPs are not blocked), and returns the data.
 *
 * Endpoint: GET /api/binance-depth?market=futures&top=30&limit=20
 *   Optional: &symbols=BTCUSDT,ETHUSDT,SOLUSDT  (skip ticker fetch)
 *
 * Returns: { market, books: { BTCUSDT: {bids, asks}, ... }, symbols, symbolCount, ts }
 *
 * Performance: Must complete within Vercel's 10s function timeout.
 *   - If `symbols` is provided, skips the ticker fetch (~instant)
 *   - If not, fetches tickers with 5s timeout, falls back to hardcoded list
 */

const FUTURES_BASES = [
  'https://fapi.binance.com/fapi/v1',
  'https://www.binance.com/fapi/v1',
];

const SPOT_BASES = [
  'https://data-api.binance.vision/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api.binance.com/api/v3',
];

// Hardcoded fallback — used when ticker fetch times out (esp. spot with 2600+ symbols)
const FALLBACK_FUTURES = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','SUIUSDT','BNBUSDT',
  'ADAUSDT','LINKUSDT','AVAXUSDT','DOTUSDT','TRXUSDT','LTCUSDT','NEARUSDT',
  'PEPEUSDT','SHIBUSDT','ARBUSDT','OPUSDT','APTUSDT','UNIUSDT','FILUSDT',
  'BCHUSDT','INJUSDT','WLDUSDT','FETUSDT','JUPUSDT','ONDOUSDT','STXUSDT',
  'SEIUSDT','TIAUSDT','ICPUSDT','AAVEUSDT','RENDERUSDT','MKRUSDT','FLOKIUSDT',
  'GRTUSDT','THETAUSDT','IMXUSDT','SNXUSDT','MATICUSDT',
];

const FALLBACK_SPOT = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT',
  'TRXUSDT','SUIUSDT','LINKUSDT','AVAXUSDT','DOTUSDT','SHIBUSDT','PEPEUSDT',
  'NEARUSDT','LTCUSDT','BCHUSDT','UNIUSDT','APTUSDT','ARBUSDT','OPUSDT',
  'FILUSDT','INJUSDT','FETUSDT','WLDUSDT','JUPUSDT','ONDOUSDT','STXUSDT',
  'SEIUSDT','TIAUSDT','ICPUSDT','AAVEUSDT','RENDERUSDT','MKRUSDT','FLOKIUSDT',
  'GRTUSDT','THETAUSDT','IMXUSDT','SNXUSDT','MATICUSDT',
];

/**
 * Fetch JSON from the first working base URL.
 */
async function fetchJSON(bases, path, timeout = 5000) {
  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 CryptoAlerts/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      return await res.json();
    } catch {
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
async function resolveSymbols(market, bases, top) {
  // Try dynamic fetch with a tight timeout (4s leaves 6s for depth)
  const tickers = await fetchJSON(bases, '/ticker/24hr', 4000);

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
  const top = Math.min(Math.max(parseInt(req.query.top) || 30, 1), 60);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 5), 50);
  const symbolsParam = req.query.symbols; // comma-separated, e.g. "BTCUSDT,ETHUSDT"

  if (market !== 'futures' && market !== 'spot') {
    return res.status(400).json({ error: 'market must be futures or spot' });
  }

  const bases = market === 'spot' ? SPOT_BASES : FUTURES_BASES;
  const startTime = Date.now();

  // Step 1: Determine symbols to scan
  let symbols, symbolSource;

  if (symbolsParam && symbolsParam.length > 0) {
    // Caller provided symbols — skip ticker fetch entirely (fastest path)
    symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, top);
    symbolSource = 'param';
  } else {
    const resolved = await resolveSymbols(market, bases, top);
    symbols = resolved.symbols;
    symbolSource = resolved.source;
  }

  if (symbols.length === 0) {
    return res.status(200).json({ market, books: {}, symbols: [], symbolCount: 0, ts: Date.now() });
  }

  // Step 2: Fetch all order books in parallel (one batch — usually < 40 requests)
  const books = {};

  await Promise.allSettled(
    symbols.map(async (symbol) => {
      const data = await fetchJSON(bases, `/depth?symbol=${symbol}&limit=${limit}`, 4000);
      if (data && (data.bids || data.asks)) {
        books[symbol] = { bids: data.bids || [], asks: data.asks || [] };
      }
    })
  );

  const elapsed = Date.now() - startTime;

  return res.status(200).json({
    market,
    books,
    symbols,           // full symbol list (so caller can cache it)
    symbolSource,      // 'param' | 'live' | 'fallback'
    symbolCount: Object.keys(books).length,
    elapsed,
    ts: Date.now(),
  });
}
