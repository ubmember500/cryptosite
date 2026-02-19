const BINANCE_FUTURES_BASE_URLS = [
  'https://fapi.binance.com/fapi/v1',
  'https://www.binance.com/fapi/v1',
];

const VALID_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);

async function fetchKlinesWithFallback(searchParams) {
  let lastError = null;

  for (const baseUrl of BINANCE_FUTURES_BASE_URLS) {
    try {
      const url = `${baseUrl}/klines?${searchParams.toString()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
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

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('Invalid Binance klines payload');
      }

      return {
        source: baseUrl,
        klines: data,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('All Binance futures hosts failed');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const symbol = String(req.query?.symbol || '').trim().toUpperCase();
  const interval = String(req.query?.interval || '15m').trim();
  const limit = Number(req.query?.limit || 500);
  const endTimeRaw = req.query?.endTime;

  if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  if (!VALID_INTERVALS.has(interval)) {
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

  try {
    const result = await fetchKlinesWithFallback(searchParams);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({
      error: error?.message || 'Failed to fetch Binance futures klines',
    });
  }
}
