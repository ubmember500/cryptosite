/**
 * Vercel Serverless Function — Binance Order Book Depth Proxy
 *
 * The backend server (Render) cannot reach Binance REST APIs directly
 * because Binance blocks cloud-provider IP ranges (HTTP 418).
 * This Vercel function acts as a proxy: Render calls here, this function
 * fetches from Binance (Vercel IPs are not blocked), and returns the data.
 *
 * Endpoint: GET /api/binance-depth?market=futures&top=40&limit=20
 *
 * Returns: { market, books: { BTCUSDT: {bids, asks}, ... }, symbolCount, ts }
 *
 * Uses fallback domains:
 *   Futures: fapi.binance.com → www.binance.com/fapi/v1
 *   Spot:    data-api.binance.vision → api.binance.com
 */

const FUTURES_BASES = [
  'https://fapi.binance.com/fapi/v1',
  'https://www.binance.com/fapi/v1',
];

const SPOT_BASES = [
  'https://data-api.binance.vision/api/v3',
  'https://api.binance.com/api/v3',
];

/**
 * Fetch JSON from the first working base URL.
 */
async function fetchJSON(bases, path, timeout = 8000) {
  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 CryptoAlerts/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        continue;
      }

      return await res.json();
    } catch {
      continue;
    }
  }
  return null;
}

export default async function handler(req, res) {
  // Allow cross-origin calls from the Render backend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const market = (req.query.market || 'futures').toLowerCase();
  const top = Math.min(Math.max(parseInt(req.query.top) || 40, 1), 80);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 5), 50);

  if (market !== 'futures' && market !== 'spot') {
    return res.status(400).json({ error: 'market must be futures or spot' });
  }

  const bases = market === 'spot' ? SPOT_BASES : FUTURES_BASES;
  const startTime = Date.now();

  // Step 1: Fetch 24hr tickers to determine top symbols by volume
  const tickers = await fetchJSON(bases, '/ticker/24hr', 10000);

  if (!tickers || !Array.isArray(tickers)) {
    return res.status(502).json({ error: 'Failed to fetch Binance tickers from all endpoints' });
  }

  // Step 2: Select top USDT symbols by quote volume
  const symbols = tickers
    .filter(t => t.symbol && t.symbol.endsWith('USDT'))
    .map(t => ({
      symbol: t.symbol,
      vol: parseFloat(t.quoteVolume || 0),
    }))
    .sort((a, b) => b.vol - a.vol)
    .slice(0, top)
    .map(t => t.symbol);

  if (symbols.length === 0) {
    return res.status(200).json({ market, books: {}, symbolCount: 0, ts: Date.now() });
  }

  // Step 3: Fetch order book depth for each symbol in parallel
  // Binance allows high concurrency from non-banned IPs
  const books = {};
  const BATCH = 20;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);

    await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchJSON(bases, `/depth?symbol=${symbol}&limit=${limit}`, 5000);
        if (data && (data.bids || data.asks)) {
          books[symbol] = { bids: data.bids || [], asks: data.asks || [] };
        }
      })
    );
  }

  const elapsed = Date.now() - startTime;

  return res.status(200).json({
    market,
    books,
    symbolCount: Object.keys(books).length,
    totalSymbols: symbols.length,
    elapsed,
    ts: Date.now(),
  });
}
