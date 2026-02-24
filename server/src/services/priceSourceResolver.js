const binanceService = require('./binanceService');
const bybitService = require('./bybitService');
const okxService = require('./okxService');
const gateService = require('./gateService');
const mexcService = require('./mexcService');
const bitgetService = require('./bitgetService');

function getExchangeService(exchange) {
  const key = String(exchange || 'binance').toLowerCase();
  if (key === 'bybit') return bybitService;
  if (key === 'okx') return okxService;
  if (key === 'gate') return gateService;
  if (key === 'mexc') return mexcService;
  if (key === 'bitget') return bitgetService;
  return binanceService;
}

function normalizeRawSymbol(rawSymbol) {
  if (typeof rawSymbol !== 'string') return '';
  return rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

function normalizeBaseForExchange(exchange, symbol) {
  const service = getExchangeService(exchange);
  const noPerp = normalizeRawSymbol(symbol).replace(/\.P$/i, '');
  if (!noPerp) return '';

  if (typeof service.normalizeSymbol === 'function') {
    try {
      const normalized = service.normalizeSymbol(noPerp);
      if (typeof normalized === 'string' && normalized) {
        return normalized.toUpperCase();
      }
    } catch {
      // ignore and fallback
    }
  }

  return noPerp;
}

function buildCandidates(exchange, rawSymbol, market) {
  const normalizedBase = normalizeBaseForExchange(exchange, rawSymbol);
  if (!normalizedBase) return [];

  const set = new Set();
  set.add(normalizedBase);

  const hasQuote = /(USDT|USD)$/i.test(normalizedBase);
  if (!hasQuote) {
    set.add(`${normalizedBase}USDT`);
    set.add(`${normalizedBase}USD`);
  } else {
    const withoutQuote = normalizedBase.replace(/USDT$|USD$/i, '');
    if (withoutQuote) set.add(withoutQuote);
  }

  if (market === 'futures') {
    for (const candidate of Array.from(set)) {
      set.add(`${candidate}.P`);
    }
  }

  return Array.from(set).filter(Boolean);
}

function resolvePriceFromMap(priceMap, candidates) {
  if (!priceMap || typeof priceMap !== 'object') {
    return { price: null, symbol: '' };
  }

  const upperMap = new Map();
  for (const [key, value] of Object.entries(priceMap)) {
    upperMap.set(String(key).toUpperCase(), { key, value: Number(value) });
  }

  for (const candidate of candidates) {
    const entry = upperMap.get(String(candidate).toUpperCase());
    if (!entry) continue;

    const price = Number(entry.value);
    if (Number.isFinite(price) && price > 0) {
      return { price, symbol: entry.key };
    }
  }

  return { price: null, symbol: '' };
}

async function fetchExchangePriceSnapshot({ exchange, market, symbol, strict = true, logger = console }) {
  const service = getExchangeService(exchange);
  const normalizedMarket = String(market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const exchangeType = normalizedMarket === 'spot' ? 'spot' : 'futures';
  const candidates = buildCandidates(exchange, symbol, normalizedMarket);

  if (candidates.length === 0) {
    return {
      ok: false,
      price: null,
      symbol: '',
      source: 'invalid_symbol',
      candidates,
      error: 'No valid symbol candidates',
    };
  }

  try {
    const priceMap = await service.getLastPricesBySymbols(candidates, exchangeType, {
      strict,
      exchangeOnly: true,
    });

    const resolved = resolvePriceFromMap(priceMap, candidates);
    if (Number.isFinite(resolved.price) && resolved.price > 0) {
      return {
        ok: true,
        price: resolved.price,
        symbol: resolved.symbol || candidates[0],
        source: `${String(exchange || 'binance').toLowerCase()}_exchange_map`,
        candidates,
      };
    }
  } catch (error) {
    logger.warn?.('[priceSourceResolver] exchange map fetch failed', {
      exchange,
      market: normalizedMarket,
      symbol,
      message: error?.message,
    });
  }

  return {
    ok: false,
    price: null,
    symbol: candidates[0] || '',
    source: `${String(exchange || 'binance').toLowerCase()}_exchange_map_unavailable`,
    candidates,
    error: 'Exchange map unavailable or symbol unresolved',
  };
}

module.exports = {
  fetchExchangePriceSnapshot,
  buildCandidates,
};
