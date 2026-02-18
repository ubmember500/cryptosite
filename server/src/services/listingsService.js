/**
 * Futures listings feed (official exchange metadata only).
 *
 * Sources:
 * - Binance USDⓈ-M exchangeInfo: /fapi/v1/exchangeInfo (uses onboardDate + status)
 * - Bybit instruments info: /v5/market/instruments-info (uses launchTime + status/isPreListing)
 * - OKX public instruments: /api/v5/public/instruments (uses listTime + state)
 *
 * Behavior:
 * - Returns ONLY futures listings (perpetual/swap + dated futures)
 * - Returns only upcoming/recent listings inside configured windows
 * - Does not use historical DB snapshots to avoid stale legacy symbols
 */

const axios = require('axios');

const LISTINGS_PAST_DAYS = Math.max(
  0,
  Number.parseInt(process.env.LISTINGS_PAST_DAYS || '0', 10)
);
const LISTINGS_UPCOMING_DAYS = Math.max(
  0,
  Number.parseInt(process.env.LISTINGS_UPCOMING_DAYS || '14', 10)
);

function toMs(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function inListingWindow(listingMs, nowMs) {
  if (!Number.isFinite(listingMs)) return false;
  const minTs = nowMs - LISTINGS_PAST_DAYS * 24 * 60 * 60 * 1000;
  const maxTs = nowMs + LISTINGS_UPCOMING_DAYS * 24 * 60 * 60 * 1000;
  return listingMs >= minTs && listingMs <= maxTs;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function normalizeBinanceSymbol(symbolObj) {
  const symbol = String(symbolObj?.symbol || '').toUpperCase();
  return symbol || null;
}

function normalizeBybitSymbol(item) {
  const symbol = String(item?.symbol || '').toUpperCase();
  return symbol || null;
}

function normalizeOkxSymbol(item) {
  const instId = String(item?.instId || '').toUpperCase();
  return instId || null;
}

async function fetchBinanceFuturesListings(nowMs) {
  const endpoint = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
  const response = await axios.get(endpoint, { timeout: 20000 });
  const symbols = Array.isArray(response.data?.symbols) ? response.data.symbols : [];

  return symbols
    .filter((s) => String(s?.quoteAsset || '').toUpperCase() === 'USDT')
    .map((s) => {
      const listingMs = toMs(s?.onboardDate);
      const symbol = normalizeBinanceSymbol(s);
      if (!symbol || !inListingWindow(listingMs, nowMs)) return null;
      const status = String(s?.status || '').toUpperCase();
      const isUpcoming = status === 'PENDING_TRADING' || listingMs > nowMs;
      return {
        exchange: 'Binance',
        market: 'futures',
        type: 'futures',
        coin: symbol,
        status: isUpcoming ? 'upcoming' : 'listed',
        listedAt: listingMs,
        date: isoDate(listingMs),
      };
    })
    .filter(Boolean);
}

async function fetchBybitLinearPage(params) {
  const endpoint = 'https://api.bybit.com/v5/market/instruments-info';
  const response = await axios.get(endpoint, {
    params,
    timeout: 20000,
  });
  if (Number(response.data?.retCode) !== 0) {
    throw new Error(response.data?.retMsg || 'Bybit instruments API error');
  }
  return response.data?.result || {};
}

async function fetchBybitFuturesListings(nowMs) {
  const all = new Map();

  // Trading listings
  let cursor = '';
  do {
    const result = await fetchBybitLinearPage({ category: 'linear', limit: 1000, cursor });
    const list = Array.isArray(result.list) ? result.list : [];
    for (const item of list) {
      all.set(String(item.symbol || '').toUpperCase(), item);
    }
    cursor = String(result.nextPageCursor || '').trim();
  } while (cursor);

  // Upcoming (pre-launch) listings
  cursor = '';
  do {
    const result = await fetchBybitLinearPage({
      category: 'linear',
      status: 'PreLaunch',
      limit: 1000,
      cursor,
    });
    const list = Array.isArray(result.list) ? result.list : [];
    for (const item of list) {
      all.set(String(item.symbol || '').toUpperCase(), item);
    }
    cursor = String(result.nextPageCursor || '').trim();
  } while (cursor);

  return Array.from(all.values())
    .filter((item) => String(item?.quoteCoin || '').toUpperCase() === 'USDT')
    .map((item) => {
      const listingMs = toMs(item?.launchTime);
      const symbol = normalizeBybitSymbol(item);
      if (!symbol || !inListingWindow(listingMs, nowMs)) return null;

      const status = String(item?.status || '').toUpperCase();
      const preListing = item?.isPreListing === true;
      const isUpcoming = preListing || status === 'PRELAUNCH' || listingMs > nowMs;

      return {
        exchange: 'Bybit',
        market: 'futures',
        type: 'futures',
        coin: symbol,
        status: isUpcoming ? 'upcoming' : 'listed',
        listedAt: listingMs,
        date: isoDate(listingMs),
      };
    })
    .filter(Boolean);
}

async function fetchOkxByInstType(instType) {
  const endpoint = 'https://www.okx.com/api/v5/public/instruments';
  const response = await axios.get(endpoint, {
    params: { instType },
    timeout: 20000,
  });
  if (response.data?.code !== '0') {
    throw new Error(response.data?.msg || 'OKX instruments API error');
  }
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

async function fetchOkxFuturesListings(nowMs) {
  const [swaps, futures] = await Promise.all([
    fetchOkxByInstType('SWAP'),
    fetchOkxByInstType('FUTURES'),
  ]);

  return [...swaps, ...futures]
    .filter((item) => String(item?.quoteCcy || '').toUpperCase() === 'USDT')
    .map((item) => {
      const listingMs = toMs(item?.listTime);
      const symbol = normalizeOkxSymbol(item);
      if (!symbol || !inListingWindow(listingMs, nowMs)) return null;

      const state = String(item?.state || '').toLowerCase();
      const isUpcoming = state !== 'live' || listingMs > nowMs;

      return {
        exchange: 'OKX',
        market: 'futures',
        type: 'futures',
        coin: symbol,
        status: isUpcoming ? 'upcoming' : 'listed',
        listedAt: listingMs,
        date: isoDate(listingMs),
      };
    })
    .filter(Boolean);
}

async function syncAndGetListings() {
  const nowMs = Date.now();

  const settled = await Promise.allSettled([
    fetchBinanceFuturesListings(nowMs),
    fetchBybitFuturesListings(nowMs),
    fetchOkxFuturesListings(nowMs),
  ]);

  const rows = [];
  for (const item of settled) {
    if (item.status === 'fulfilled' && Array.isArray(item.value)) {
      rows.push(...item.value);
    }
  }

  rows.sort((a, b) => {
    if ((b.listedAt || 0) !== (a.listedAt || 0)) return (b.listedAt || 0) - (a.listedAt || 0);
    return String(a.exchange).localeCompare(String(b.exchange));
  });

  return rows.map(({ listedAt, ...rest }) => rest);
}

module.exports = {
  syncAndGetListings,
};
