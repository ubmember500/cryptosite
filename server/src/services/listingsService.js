const axios = require('axios');
const prisma = require('../utils/prisma');

/* ─── Constants ─── */
const MONITORED_EXCHANGES = ['Binance', 'Bybit', 'OKX', 'MEXC', 'Bitget', 'Gate.io'];
const REFRESH_INTERVAL_MS = Math.max(60_000, Number.parseInt(process.env.LISTINGS_REFRESH_MS || '3600000', 10)); // 1 hour

let refreshTimer = null;
let refreshInFlight = null;
let memorySnapshot = {
  listings: [],
  meta: {
    lastUpdatedAt: null,
    sources: MONITORED_EXCHANGES.map((exchange) => ({ exchange, count: 0 })),
  },
};

/* ─── Helpers ─── */
function toMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function isoDateTime(ms) {
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

/** True when timestamp is strictly in the future */
function isUpcoming(ms, nowMs) {
  return Number.isFinite(ms) && ms > nowMs;
}

async function getWithFallback(urls, config = {}) {
  let lastError = null;
  for (const url of urls) {
    try {
      return await axios.get(url, config);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function dedup(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.exchange}|${row.market}|${row.coin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addSourceMeta(listings, lastUpdatedAt) {
  const countMap = new Map(MONITORED_EXCHANGES.map((exchange) => [exchange, 0]));
  for (const row of listings) {
    countMap.set(row.exchange, (countMap.get(row.exchange) || 0) + 1);
  }
  return {
    listings,
    meta: {
      lastUpdatedAt,
      sources: MONITORED_EXCHANGES.map((exchange) => ({
        exchange,
        count: countMap.get(exchange) || 0,
      })),
    },
  };
}

/* ─── DB helpers ─── */
async function ensureListingsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FutureListing" (
      "id" TEXT NOT NULL,
      "exchange" TEXT NOT NULL,
      "symbol" TEXT NOT NULL,
      "firstSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "FutureListing_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "FutureListing_exchange_idx" ON "FutureListing"("exchange");');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "FutureListing_exchange_symbol_key" ON "FutureListing"("exchange", "symbol");');
}

function toDbSymbol(row) {
  return `${row.market}:${row.coin}`;
}

function fromDbSymbol(symbol) {
  const [market, ...coinParts] = String(symbol || '').split(':');
  const coin = coinParts.join(':') || String(symbol || '');
  return { market: market || 'futures', coin };
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function persistSnapshot(rows) {
  const dbRows = rows.map((row) => ({
    id: cryptoRandomId(),
    exchange: row.exchange,
    symbol: toDbSymbol(row),
    firstSeenAt: new Date(row.listedAt || Date.now()),
  }));

  await prisma.$transaction(async (tx) => {
    await tx.futureListing.deleteMany({});
    if (dbRows.length > 0) {
      await tx.futureListing.createMany({ data: dbRows });
    }
  });
}

async function loadSnapshotFromDb() {
  await ensureListingsTable();
  const nowMs = Date.now();
  // Only load rows that are status-based (detected recently) or have a future timestamp.
  // firstSeenAt stores the listing launch time OR Date.now() for status-based items.
  // We reload all rows — the refresh cycle keeps only future/status-based items in DB.
  const rows = await prisma.futureListing.findMany({
    where: {
      firstSeenAt: { gte: new Date(nowMs - 7 * 24 * 3600_000) }, // within last 7 days (covers status-based items)
    },
    orderBy: [{ firstSeenAt: 'asc' }, { exchange: 'asc' }],
  });

  const listings = rows.map((row) => {
    const parsed = fromDbSymbol(row.symbol);
    const listedAt = new Date(row.firstSeenAt).getTime();
    return {
      exchange: row.exchange,
      market: parsed.market,
      type: parsed.market,
      coin: parsed.coin,
      status: 'upcoming',
      date: isoDateTime(listedAt) || 'TBA',
      listedAt,
    };
  });

  const normalized = dedup(listings)
    .sort((a, b) => (a.listedAt || 0) - (b.listedAt || 0))
    .map(({ listedAt, ...rest }) => rest);

  const lastUpdatedAt = rows.length > 0
    ? new Date(Math.max(...rows.map((r) => new Date(r.firstSeenAt).getTime()))).toISOString()
    : null;

  return addSourceMeta(normalized, lastUpdatedAt);
}

/* ─── Exchange fetchers ─── */

// Binance Futures: PENDING_TRADING status = upcoming, regardless of timestamp
async function fetchBinanceFutures() {
  const { data } = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', { timeout: 20000 });
  return (data?.symbols || [])
    .filter((item) => {
      const q = String(item?.quoteAsset || '').toUpperCase();
      const st = String(item?.status || '').toUpperCase();
      return q === 'USDT' && st === 'PENDING_TRADING';
    })
    .map((item) => {
      const listedAt = toMs(item?.onboardDate);
      return {
        exchange: 'Binance',
        market: 'futures',
        type: 'futures',
        coin: String(item?.baseAsset || item?.symbol || '').toUpperCase(),
        status: 'upcoming', // PENDING_TRADING status IS the signal
        listedAt,
        date: isoDateTime(listedAt) || 'TBA',
      };
    })
    .filter((item) => item.coin);
}

// Binance Spot Announcements: articles from last 30 days, parse coin tickers
async function fetchBinanceSpotAnnouncements(nowMs) {
  const { data } = await axios.get(
    'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=30',
    {
      timeout: 20000,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
    }
  );

  const articles = data?.data?.catalogs?.[0]?.articles || data?.data?.articles || [];
  const excluded = new Set(['USDT', 'USD', 'BTC', 'ETH', 'BNB', 'AND', 'THE', 'FOR', 'ON', 'WILL', 'NEW']);
  const rows = [];
  const thirtyDaysAgo = nowMs - 30 * 86400_000;

  for (const article of articles) {
    const title = String(article?.title || '');
    const releaseMs = toMs(article?.releaseDate);
    if (!releaseMs || releaseMs < thirtyDaysAgo) continue;

    const market = /futures|perpetual/i.test(title) ? 'futures' : 'spot';
    const status = isUpcoming(releaseMs, nowMs) ? 'upcoming' : 'listed';
    const matches = [
      ...title.matchAll(/\(([A-Z0-9]{2,20})(?:\/USDT)?\)/g),
      ...title.matchAll(/Will List ([A-Z0-9]{2,20})[\s(]/g),
      ...title.matchAll(/Lists ([A-Z0-9]{2,20})[\s(]/g),
    ];

    for (const match of matches) {
      const coin = String(match?.[1] || '').toUpperCase();
      if (!coin || excluded.has(coin)) continue;
      rows.push({
        exchange: 'Binance',
        market,
        type: market,
        coin,
        status,
        listedAt: releaseMs,
        date: isoDateTime(releaseMs),
      });
    }
  }

  return rows;
}

// Bybit: ALL PreLaunch items are upcoming regardless of launchTime
async function fetchBybitPage(params) {
  const { data } = await getWithFallback(
    [
      'https://api.bybit.com/v5/market/instruments-info',
      'https://api.bytick.com/v5/market/instruments-info',
    ],
    {
      params,
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CryptoAlertsBot/1.0)' },
    }
  );
  if (Number(data?.retCode) !== 0) {
    throw new Error(data?.retMsg || 'Bybit API error');
  }
  return data?.result || {};
}

async function fetchBybitFutures() {
  const all = new Map();
  let cursor = '';
  do {
    const page = await fetchBybitPage({
      category: 'linear',
      status: 'PreLaunch',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of Array.isArray(page?.list) ? page.list : []) {
      all.set(String(item?.symbol || '').toUpperCase(), item);
    }
    cursor = String(page?.nextPageCursor || '').trim();
  } while (cursor);

  return Array.from(all.values())
    .filter((item) => String(item?.quoteCoin || '').toUpperCase() === 'USDT')
    .map((item) => {
      const coin = String(item?.baseCoin || item?.symbol || '').toUpperCase();
      if (!coin) return null;
      const launchMs = toMs(item?.launchTime);
      return {
        exchange: 'Bybit',
        market: 'futures',
        type: 'futures',
        coin,
        status: 'upcoming', // PreLaunch status IS the signal
        listedAt: launchMs,
        date: isoDateTime(launchMs) || 'TBA',
      };
    })
    .filter(Boolean);
}

// OKX: future listings only
async function fetchOkxByType(instType, nowMs) {
  const { data } = await axios.get('https://www.okx.com/api/v5/public/instruments', {
    params: { instType },
    timeout: 20000,
  });
  if (String(data?.code) !== '0') {
    throw new Error(data?.msg || 'OKX API error');
  }

  return (Array.isArray(data?.data) ? data.data : [])
    .filter((item) => {
      const settle = String(item?.settleCcy || item?.quoteCcy || '').toUpperCase();
      const lt = toMs(item?.listTime);
      return settle === 'USDT' && isUpcoming(lt, nowMs);
    })
    .map((item) => {
      const listedAt = toMs(item?.listTime);
      return {
        exchange: 'OKX',
        market: 'futures',
        type: 'futures',
        coin: String(item?.ctValCcy || item?.baseCcy || item?.instId || '').toUpperCase(),
        status: 'upcoming',
        listedAt,
        date: isoDateTime(listedAt),
      };
    });
}

async function fetchOkxFutures(nowMs) {
  const [swaps, futures] = await Promise.all([
    fetchOkxByType('SWAP', nowMs),
    fetchOkxByType('FUTURES', nowMs),
  ]);
  return [...swaps, ...futures];
}

// MEXC Spot: status '2' = pre-listing (status-based), or future openTime
async function fetchMexcSpot(nowMs) {
  const { data } = await axios.get('https://api.mexc.com/api/v3/exchangeInfo', { timeout: 20000 });
  return (data?.symbols || [])
    .filter((item) => {
      const ot = toMs(item?.openTime);
      if (ot && isUpcoming(ot, nowMs)) return true;
      // status '2' indicates pre-listing on MEXC — status IS the signal
      if (String(item?.status) === '2') return true;
      return false;
    })
    .map((item) => {
      const listedAt = toMs(item?.openTime);
      return {
        exchange: 'MEXC',
        market: 'spot',
        type: 'spot',
        coin: String(item?.baseAsset || '').toUpperCase(),
        status: 'upcoming',
        listedAt,
        date: isoDateTime(listedAt) || 'TBA',
      };
    })
    .filter((item) => item.coin);
}

// MEXC Futures: future listings only (handles 403 gracefully via try/catch in collectRows)
async function fetchMexcFutures(nowMs) {
  const { data } = await axios.get('https://contract.mexc.com/api/v1/contract/list', { timeout: 20000 });
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((item) => {
      const listedAt = toMs(item?.launchTime || item?.openTime);
      return String(item?.quoteCoin || item?.symbol || '').toUpperCase().includes('USDT') && isUpcoming(listedAt, nowMs);
    })
    .map((item) => {
      const listedAt = toMs(item?.launchTime || item?.openTime);
      return {
        exchange: 'MEXC',
        market: 'futures',
        type: 'futures',
        coin: String(item?.baseCoin || item?.symbol || '').toUpperCase().replace(/_?USDT$/, ''),
        status: 'upcoming',
        listedAt,
        date: isoDateTime(listedAt),
      };
    })
    .filter((item) => item.coin);
}

// Bitget Spot: future listings only
async function fetchBitgetSpot(nowMs) {
  const { data } = await axios.get('https://api.bitget.com/api/v2/spot/public/symbols', { timeout: 20000 });
  return (data?.data || [])
    .filter((item) => {
      const q = String(item?.quoteCoin || '').toUpperCase();
      const lt = toMs(item?.openTime || item?.listTime);
      return q === 'USDT' && isUpcoming(lt, nowMs);
    })
    .map((item) => {
      const listedAt = toMs(item?.openTime || item?.listTime);
      return {
        exchange: 'Bitget',
        market: 'spot',
        type: 'spot',
        coin: String(item?.baseCoin || '').toUpperCase(),
        status: 'upcoming',
        listedAt,
        date: isoDateTime(listedAt),
      };
    })
    .filter((item) => item.coin);
}

// Bitget Futures: future listings only
async function fetchBitgetFutures(nowMs) {
  const { data } = await axios.get('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES', { timeout: 20000 });
  return (data?.data || [])
    .filter((item) => {
      const lt = toMs(item?.launchTime || item?.openTime || item?.listTime);
      return isUpcoming(lt, nowMs);
    })
    .map((item) => {
      const listedAt = toMs(item?.launchTime || item?.openTime || item?.listTime);
      return {
        exchange: 'Bitget',
        market: 'futures',
        type: 'futures',
        coin: String(item?.baseCoin || item?.symbol || '').toUpperCase().replace(/USDT$/, ''),
        status: 'upcoming',
        listedAt,
        date: isoDateTime(listedAt),
      };
    })
    .filter((item) => item.coin);
}

// Gate.io Futures: future listings only
async function fetchGateFutures(nowMs) {
  const { data } = await axios.get('https://api.gateio.ws/api/v4/futures/usdt/contracts', { timeout: 20000 });
  return (Array.isArray(data) ? data : [])
    .filter((item) => {
      const listedAt = toMs(item?.create_time);
      return isUpcoming(listedAt, nowMs);
    })
    .map((item) => {
      const listedAt = toMs(item?.create_time);
      return {
        exchange: 'Gate.io',
        market: 'futures',
        type: 'futures',
        coin: String(item?.name || '').toUpperCase().replace('_USDT', ''),
        status: 'upcoming',
        listedAt,
        date: isoDateTime(listedAt),
      };
    })
    .filter((item) => item.coin);
}

/* ─── Collection & scheduling ─── */
async function collectRows() {
  const nowMs = Date.now();
  const settled = await Promise.allSettled([
    fetchBinanceFutures(),
    fetchBinanceSpotAnnouncements(nowMs),
    fetchBybitFutures(),
    fetchOkxFutures(nowMs),
    fetchMexcSpot(nowMs),
    fetchMexcFutures(nowMs),
    fetchBitgetSpot(nowMs),
    fetchBitgetFutures(nowMs),
    fetchGateFutures(nowMs),
  ]);

  const rows = [];
  for (const item of settled) {
    if (item.status === 'fulfilled' && Array.isArray(item.value)) {
      rows.push(...item.value);
    } else if (item.status === 'rejected') {
      console.warn('[listingsService] source failed:', item.reason?.message || String(item.reason));
    }
  }

  return dedup(rows)
    .sort((a, b) => (a.listedAt || 0) - (b.listedAt || 0))
    .map(({ listedAt, ...rest }) => ({ ...rest, listedAt }));
}

async function refreshListingsSnapshot() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    await ensureListingsTable();
    const rows = await collectRows();
    if (rows.length > 0) {
      await persistSnapshot(rows);
      const outputRows = rows.map(({ listedAt, ...rest }) => rest);
      memorySnapshot = addSourceMeta(outputRows, new Date().toISOString());
      console.log(`[listingsService] refreshed: ${rows.length} listings from ${MONITORED_EXCHANGES.length} exchanges`);
      return memorySnapshot;
    }

    const dbSnapshot = await loadSnapshotFromDb();
    memorySnapshot = dbSnapshot;
    return memorySnapshot;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function getListingsSnapshot() {
  if (memorySnapshot.listings.length > 0) {
    return memorySnapshot;
  }
  // No cached data — run a fresh refresh (joins any in-flight refresh automatically)
  return refreshListingsSnapshot();
}

function startListingsSyncScheduler() {
  if (refreshTimer) return;

  refreshListingsSnapshot().catch((error) => {
    console.warn('[listingsService] initial refresh failed:', error.message || String(error));
  });

  refreshTimer = setInterval(() => {
    refreshListingsSnapshot().catch((error) => {
      console.warn('[listingsService] scheduled refresh failed:', error.message || String(error));
    });
  }, REFRESH_INTERVAL_MS);
}

function stopListingsSyncScheduler() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

module.exports = {
  getListingsSnapshot,
  refreshListingsSnapshot,
  startListingsSyncScheduler,
  stopListingsSyncScheduler,
};
