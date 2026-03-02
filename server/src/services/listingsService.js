/**
 * Upcoming listings feed — spot AND futures upcoming listings.
 *
 * Sources:
 *  Binance  — fapi/v1/exchangeInfo (futures PENDING_TRADING)
 *           — CMS announcements feed (spot upcoming)
 *  Bybit    — /v5/market/instruments-info?status=PreLaunch
 *  OKX      — /api/v5/public/instruments (SWAP + FUTURES with listTime > now)
 *  MEXC     — /api/v3/exchangeInfo (spot openTime > now)
 *           — contract.mexc.com/api/v1/contract/list (futures launchTime > now)
 *  Bitget   — /api/v2/spot/public/symbols (openTime > now)
 *           — /api/v2/mix/market/contracts USDT-FUTURES (launchTime > now)
 *  Gate.io  — /api/v4/futures/usdt/contracts (create_time > now)
 *
 * Behavior:
 *  - Upcoming only (no past listings)
 *  - 5-minute in-memory TTL cache (fast repeat requests)
 *  - Promise.allSettled — one exchange down never kills the whole response
 */

const axios = require('axios');

// ─── constants ────────────────────────────────────────────────────────────────

const UPCOMING_DAYS = Math.max(0, Number.parseInt(process.env.LISTINGS_UPCOMING_DAYS || '60', 10));
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutes

let _cache = { data: null, expiresAt: 0 };

// ─── helpers ──────────────────────────────────────────────────────────────────

function toMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Gate.io uses Unix seconds; anything < 1e12 is seconds, not ms
  return n < 1e12 ? n * 1000 : n;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function isUpcomingMs(ms, nowMs) {
  return Number.isFinite(ms) && ms > nowMs && ms <= nowMs + UPCOMING_DAYS * 86400_000;
}

// ─── Binance futures (PENDING_TRADING only) ───────────────────────────────────

async function fetchBinanceFutures(nowMs) {
  const { data } = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {
    timeout: 20000,
  });
  return (data?.symbols || [])
    .filter(
      (s) =>
        String(s?.quoteAsset || '').toUpperCase() === 'USDT' &&
        String(s?.status || '').toUpperCase() === 'PENDING_TRADING' &&
        isUpcomingMs(toMs(s?.onboardDate), nowMs)
    )
    .map((s) => ({
      exchange: 'Binance',
      market: 'futures',
      type: 'futures',
      coin: String(s?.baseAsset || s?.symbol || '').toUpperCase(),
      status: 'upcoming',
      listedAt: toMs(s.onboardDate),
      date: isoDate(toMs(s.onboardDate)),
    }));
}

// ─── Binance spot (CMS announcements) ─────────────────────────────────────────
// catalogId=48 = "New Listings" category on Binance announcements

async function fetchBinanceSpotAnnouncements(nowMs) {
  const url =
    'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query' +
    '?type=1&catalogId=48&pageNo=1&pageSize=20';
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible)',
    },
  });

  const articles =
    data?.data?.catalogs?.[0]?.articles ||
    data?.data?.articles ||
    [];

  const results = [];

  for (const article of articles) {
    const title   = String(article?.title || '');
    const relDate = toMs(article?.releaseDate);

    // Only articles that are recent enough to signal an upcoming listing
    if (!relDate || relDate <= nowMs - 2 * 86400_000) continue; // allow 2 days back
    if (relDate > nowMs + UPCOMING_DAYS * 86400_000) continue;

    const isFutures = /futures|perpetual/i.test(title);
    const market = isFutures ? 'futures' : 'spot';

    // Match: "Will List TOKEN (TOKEN)" or "(TOKEN/USDT)" style brackets
    const bracketMatches = [...title.matchAll(/\(([A-Z0-9]{2,20})(?:\/USDT)?\)/g)];
    const directMatches  = [...title.matchAll(/Will List ([A-Z0-9]{2,20})[\s(]/g)];

    const EXCLUDED = new Set(['USDT', 'USD', 'BTC', 'ETH', 'BNB', 'AND', 'THE', 'FOR', 'ON']);
    const coins = [
      ...bracketMatches.map((m) => m[1]),
      ...directMatches.map((m) => m[1]),
    ].filter((c) => !EXCLUDED.has(c));

    const seen = new Set();
    for (const coin of coins) {
      if (!seen.has(coin)) {
        seen.add(coin);
        results.push({
          exchange: 'Binance',
          market,
          type: market,
          coin,
          status: 'upcoming',
          listedAt: relDate,
          date: isoDate(relDate),
        });
      }
    }
  }
  return results;
}

// ─── Bybit (PreLaunch only) ───────────────────────────────────────────────────

async function fetchBybitPage(params) {
  const { data } = await axios.get('https://api.bybit.com/v5/market/instruments-info', {
    params,
    timeout: 20000,
  });
  if (Number(data?.retCode) !== 0) throw new Error(data?.retMsg || 'Bybit API error');
  return data?.result || {};
}

async function fetchBybitFutures(nowMs) {
  const all = new Map();
  let cursor = '';
  do {
    const result = await fetchBybitPage({
      category: 'linear',
      status: 'PreLaunch',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of Array.isArray(result.list) ? result.list : []) {
      all.set(String(item.symbol || '').toUpperCase(), item);
    }
    cursor = String(result.nextPageCursor || '').trim();
  } while (cursor);

  return Array.from(all.values())
    .filter((item) => String(item?.quoteCoin || '').toUpperCase() === 'USDT')
    .map((item) => {
      const listingMs = toMs(item?.launchTime);
      const coin = String(item?.baseCoin || item?.symbol || '').toUpperCase();
      if (!coin || !Number.isFinite(listingMs) || listingMs <= nowMs) return null;
      // No upper-cap for confirmed PreLaunch: they may be months away but are announced
      return {
        exchange: 'Bybit',
        market: 'futures',
        type: 'futures',
        coin,
        status: 'upcoming',
        listedAt: listingMs,
        date: isoDate(listingMs),
      };
    })
    .filter(Boolean);
}

// ─── OKX ──────────────────────────────────────────────────────────────────────

async function fetchOkxByType(instType, nowMs) {
  const { data } = await axios.get('https://www.okx.com/api/v5/public/instruments', {
    params: { instType },
    timeout: 20000,
  });
  if (data?.code !== '0') throw new Error(data?.msg || 'OKX instruments API error');
  const items = Array.isArray(data?.data) ? data.data : [];

  return items
    .filter((item) => {
      const settle = String(item?.settleCcy || item?.quoteCcy || '').toUpperCase();
      const listingMs = toMs(item?.listTime);
      return settle === 'USDT' && isUpcomingMs(listingMs, nowMs);
    })
    .map((item) => ({
      exchange: 'OKX',
      market: 'futures',
      type: 'futures',
      coin: String(item?.baseCcy || item?.instId || '').toUpperCase(),
      status: 'upcoming',
      listedAt: toMs(item?.listTime),
      date: isoDate(toMs(item?.listTime)),
    }));
}

async function fetchOkxFutures(nowMs) {
  const [swaps, futures] = await Promise.all([
    fetchOkxByType('SWAP', nowMs),
    fetchOkxByType('FUTURES', nowMs),
  ]);
  return [...swaps, ...futures];
}

// ─── MEXC spot ────────────────────────────────────────────────────────────────

async function fetchMexcSpot(nowMs) {
  const { data } = await axios.get('https://api.mexc.com/api/v3/exchangeInfo', {
    timeout: 20000,
  });
  return (data?.symbols || [])
    .filter((s) => isUpcomingMs(toMs(s?.openTime), nowMs))
    .map((s) => ({
      exchange: 'MEXC',
      market: 'spot',
      type: 'spot',
      coin: String(s?.baseAsset || '').toUpperCase(),
      status: 'upcoming',
      listedAt: toMs(s.openTime),
      date: isoDate(toMs(s.openTime)),
    }))
    .filter((r) => r.coin);
}

// ─── MEXC futures ─────────────────────────────────────────────────────────────

async function fetchMexcFutures(nowMs) {
  const { data } = await axios.get('https://contract.mexc.com/api/v1/contract/list', {
    timeout: 20000,
  });
  const contracts = Array.isArray(data?.data) ? data.data : [];
  return contracts
    .filter((c) => {
      const launchMs = toMs(c?.launchTime || c?.openTime);
      return (
        String(c?.quoteCoin || c?.symbol || '').toUpperCase().includes('USDT') &&
        isUpcomingMs(launchMs, nowMs)
      );
    })
    .map((c) => {
      const coin = String(c?.baseCoin || c?.symbol || '')
        .toUpperCase()
        .replace(/_?USDT$/, '');
      return {
        exchange: 'MEXC',
        market: 'futures',
        type: 'futures',
        coin,
        status: 'upcoming',
        listedAt: toMs(c.launchTime || c.openTime),
        date: isoDate(toMs(c.launchTime || c.openTime)),
      };
    })
    .filter((r) => r.coin);
}

// ─── Bitget spot ──────────────────────────────────────────────────────────────

async function fetchBitgetSpot(nowMs) {
  const { data } = await axios.get('https://api.bitget.com/api/v2/spot/public/symbols', {
    timeout: 20000,
  });
  return (data?.data || [])
    .filter((s) => {
      const openTime = toMs(s?.openTime || s?.listTime);
      return String(s?.quoteCoin || '').toUpperCase() === 'USDT' && isUpcomingMs(openTime, nowMs);
    })
    .map((s) => ({
      exchange: 'Bitget',
      market: 'spot',
      type: 'spot',
      coin: String(s?.baseCoin || '').toUpperCase(),
      status: 'upcoming',
      listedAt: toMs(s.openTime || s.listTime),
      date: isoDate(toMs(s.openTime || s.listTime)),
    }))
    .filter((r) => r.coin);
}

// ─── Bitget futures ───────────────────────────────────────────────────────────

async function fetchBitgetFutures(nowMs) {
  const { data } = await axios.get(
    'https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES',
    { timeout: 20000 }
  );
  return (data?.data || [])
    .filter((c) => {
      const launchMs = toMs(c?.launchTime || c?.openTime || c?.listTime);
      return isUpcomingMs(launchMs, nowMs);
    })
    .map((c) => ({
      exchange: 'Bitget',
      market: 'futures',
      type: 'futures',
      coin: String(c?.baseCoin || c?.symbol || '')
        .toUpperCase()
        .replace(/USDT$/, ''),
      status: 'upcoming',
      listedAt: toMs(c.launchTime || c.openTime || c.listTime),
      date: isoDate(toMs(c.launchTime || c.openTime || c.listTime)),
    }))
    .filter((r) => r.coin);
}

// ─── Gate.io futures ──────────────────────────────────────────────────────────

async function fetchGateFutures(nowMs) {
  const { data } = await axios.get('https://api.gateio.ws/api/v4/futures/usdt/contracts', {
    timeout: 20000,
  });
  return (Array.isArray(data) ? data : [])
    .filter((c) => isUpcomingMs(toMs(c?.create_time), nowMs))
    .map((c) => ({
      exchange: 'Gate.io',
      market: 'futures',
      type: 'futures',
      coin: String(c?.name || '').toUpperCase().replace('_USDT', ''),
      status: 'upcoming',
      listedAt: toMs(c.create_time),
      date: isoDate(toMs(c.create_time)),
    }))
    .filter((r) => r.coin);
}

// ─── dedup ────────────────────────────────────────────────────────────────────

function dedup(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.exchange}|${r.coin}|${r.market}|${r.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── main export ─────────────────────────────────────────────────────────────

async function syncAndGetListings() {
  const nowMs = Date.now();

  // Return cached data if still fresh
  if (_cache.data && nowMs < _cache.expiresAt) {
    return _cache.data;
  }

  const settled = await Promise.allSettled([
    fetchBinanceFutures(nowMs),
    fetchBinanceSpotAnnouncements(nowMs),
    fetchBybitFutures(nowMs),
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

  // Sort: soonest first
  rows.sort((a, b) => (a.listedAt || 0) - (b.listedAt || 0));

  const result = dedup(rows).map(({ listedAt, ...rest }) => rest);

  // Cache result for 5 minutes
  _cache = { data: result, expiresAt: nowMs + CACHE_TTL_MS };

  return result;
}

module.exports = { syncAndGetListings };
