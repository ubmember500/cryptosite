const ccxt = require('ccxt');
const axios = require('axios');

const exchangeInstances = new Map();
const marketLoadPromises = new Map();
const coingeckoSymbolCache = new Map();
const COINGECKO_CACHE_TTL_MS = 60000;

function normalizeExchange(exchange) {
  const key = String(exchange || '').trim().toLowerCase();
  if (key === 'binance' || key === 'bybit') return key;
  return null;
}

function extractBaseAsset(symbol) {
  if (typeof symbol !== 'string') return '';
  const upper = symbol.trim().toUpperCase();
  if (!upper) return '';
  const base = upper.replace(/USDT$|USD$/i, '');
  return base || upper;
}

function buildCcxtCandidates(symbol, market) {
  const base = extractBaseAsset(symbol);
  if (!base) return [];
  if (market === 'spot') {
    return [`${base}/USDT`, `${base}/USD`];
  }
  return [`${base}/USDT:USDT`, `${base}/USDT`, `${base}/USD:USD`];
}

function getCcxtInstance(exchange, market) {
  const exchangeId = normalizeExchange(exchange);
  if (!exchangeId) return null;

  const marketType = market === 'spot' ? 'spot' : 'swap';
  const key = `${exchangeId}:${marketType}`;
  if (!exchangeInstances.has(key)) {
    exchangeInstances.set(
      key,
      new ccxt[exchangeId]({
        enableRateLimit: true,
        timeout: 15000,
        options: {
          defaultType: marketType,
        },
      })
    );
  }
  return exchangeInstances.get(key);
}

async function ensureMarkets(exchange, market) {
  const instance = getCcxtInstance(exchange, market);
  if (!instance) return null;

  const marketType = market === 'spot' ? 'spot' : 'swap';
  const key = `${instance.id}:${marketType}`;
  if (!marketLoadPromises.has(key)) {
    marketLoadPromises.set(key, instance.loadMarkets());
  }

  await marketLoadPromises.get(key);
  return instance;
}

async function fetchCoinGeckoPriceByBase(baseAsset) {
  const base = String(baseAsset || '').trim().toLowerCase();
  if (!base) return null;

  const cached = coingeckoSymbolCache.get(base);
  const now = Date.now();
  if (cached && now - cached.timestamp < COINGECKO_CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const searchResp = await axios.get('https://api.coingecko.com/api/v3/search', {
      params: { query: base },
      timeout: 8000,
    });

    const coins = Array.isArray(searchResp?.data?.coins) ? searchResp.data.coins : [];
    const exact = coins
      .filter((coin) => String(coin?.symbol || '').toLowerCase() === base)
      .sort((left, right) => {
        const leftRank = Number.isFinite(left?.market_cap_rank) ? left.market_cap_rank : Number.MAX_SAFE_INTEGER;
        const rightRank = Number.isFinite(right?.market_cap_rank) ? right.market_cap_rank : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      })[0] || coins[0];

    const coinId = exact?.id;
    if (!coinId) return null;

    const priceResp = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: coinId, vs_currencies: 'usd' },
      timeout: 8000,
    });

    const usd = Number(priceResp?.data?.[coinId]?.usd);
    if (!Number.isFinite(usd) || usd <= 0) return null;

    coingeckoSymbolCache.set(base, { price: usd, timestamp: now });
    return usd;
  } catch (error) {
    console.warn(`[exchangeFallbackPriceService] CoinGecko fallback failed for ${baseAsset}:`, error.message);
    return null;
  }
}

async function fetchPriceViaCcxt({ exchange, symbol, market }) {
  const exchangeId = normalizeExchange(exchange);
  if (!exchangeId) return null;

  try {
    const instance = await ensureMarkets(exchangeId, market);
    if (!instance) return null;

    const candidates = buildCcxtCandidates(symbol, market);
    for (const candidate of candidates) {
      try {
        const marketExists = !instance.markets || !!instance.markets[candidate];
        if (!marketExists) continue;

        const ticker = await instance.fetchTicker(candidate);
        const price = Number(ticker?.last ?? ticker?.close ?? ticker?.info?.lastPrice ?? ticker?.info?.last);
        if (Number.isFinite(price) && price > 0) {
          return price;
        }
      } catch (error) {
        console.warn(`[exchangeFallbackPriceService] CCXT ticker failed ${exchangeId} ${candidate}:`, error.message);
      }
    }
  } catch (error) {
    console.warn(`[exchangeFallbackPriceService] CCXT setup failed for ${exchangeId}:`, error.message);
  }

  const baseAsset = extractBaseAsset(symbol);
  return fetchCoinGeckoPriceByBase(baseAsset);
}

module.exports = {
  fetchPriceViaCcxt,
};
