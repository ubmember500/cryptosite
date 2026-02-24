const binanceService = require('./binanceService');
const bybitService = require('./bybitService');
const okxService = require('./okxService');
const gateService = require('./gateService');
const mexcService = require('./mexcService');
const bitgetService = require('./bitgetService');

function getExchangeService(exchange, { allowDefault = true } = {}) {
  const key = String(exchange || '').toLowerCase();
  if (!key) return allowDefault ? binanceService : null;
  if (key === 'bybit') return bybitService;
  if (key === 'okx') return okxService;
  if (key === 'gate') return gateService;
  if (key === 'mexc') return mexcService;
  if (key === 'bitget') return bitgetService;
  if (key === 'binance') return binanceService;
  return allowDefault ? binanceService : null;
}

function normalizeRawSymbol(rawSymbol) {
  if (typeof rawSymbol !== 'string') return '';
  return rawSymbol.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeBaseForExchange(exchange, symbol) {
  const service = getExchangeService(exchange, { allowDefault: false });
  const cleanedRaw = normalizeRawSymbol(symbol)
    .replace(/\.P$/i, '')
    .replace(/-PERP(ETUAL)?$/i, '')
    .replace(/PERP$/i, '')
    .replace(/-SWAP$/i, '')
    .replace(/_PERP(ETUAL)?$/i, '');
  if (!cleanedRaw) return '';

  if (typeof service.normalizeSymbol === 'function') {
    try {
      const normalized = service.normalizeSymbol(cleanedRaw);
      if (typeof normalized === 'string' && normalized) {
        return normalized.toUpperCase();
      }
    } catch {
      // ignore and fallback
    }
  }

  return cleanedRaw.replace(/[^A-Z0-9]/g, '');
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
  const exchangeKey = String(exchange || '').toLowerCase();
  const service = getExchangeService(exchangeKey, { allowDefault: false });
  const normalizedMarket = String(market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const exchangeType = normalizedMarket === 'spot' ? 'spot' : 'futures';

  if (!service) {
    return {
      ok: false,
      status: 'unresolved',
      reasonCode: 'UNSUPPORTED_EXCHANGE',
      price: null,
      symbol: '',
      source: 'unsupported_exchange',
      candidates: [],
      error: `Unsupported exchange: ${exchange}`,
    };
  }

  const candidates = buildCandidates(exchange, symbol, normalizedMarket);

  if (candidates.length === 0) {
    return {
      ok: false,
      status: 'unresolved',
      reasonCode: 'INVALID_SYMBOL',
      price: null,
      symbol: '',
      source: 'invalid_symbol',
      candidates,
      error: 'No valid symbol candidates',
    };
  }

  if (typeof service.fetchCurrentPriceBySymbol === 'function') {
    for (const candidate of candidates) {
      try {
        const directPrice = Number(
          await service.fetchCurrentPriceBySymbol(candidate, exchangeType, {
            strict,
            exchangeOnly: true,
          })
        );
        if (Number.isFinite(directPrice) && directPrice > 0) {
          return {
            ok: true,
            status: 'resolved',
            price: directPrice,
            symbol: candidate,
            source: `${exchangeKey}_direct_symbol_ticker`,
            candidates,
          };
        }
      } catch (error) {
        logger.warn?.('[priceSourceResolver] direct symbol fetch failed', {
          exchange,
          market: normalizedMarket,
          symbol: candidate,
          message: error?.message,
        });
      }
    }
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
        status: 'resolved',
        price: resolved.price,
        symbol: resolved.symbol || candidates[0],
        source: `${exchangeKey}_exchange_map`,
        candidates,
      };
    }
  } catch (error) {
    logger.warn?.('[priceSourceResolver] exchange map fetch failed', {
      exchange,
      market: normalizedMarket,
      symbol,
      message: error?.message,
      code: error?.code,
    });

    if (strict && error?.code === 'UPSTREAM_PRICE_UNAVAILABLE') {
      return {
        ok: false,
        status: 'unresolved',
        reasonCode: 'UPSTREAM_PRICE_UNAVAILABLE',
        price: null,
        symbol: candidates[0] || '',
        source: `${exchangeKey}_exchange_map_unavailable`,
        candidates,
        error: error?.message || 'Exchange map unavailable',
      };
    }
  }

  return {
    ok: false,
    status: 'unresolved',
    reasonCode: 'SYMBOL_UNRESOLVED',
    price: null,
    symbol: candidates[0] || '',
    source: `${exchangeKey}_exchange_map_unavailable`,
    candidates,
    error: 'Exchange map unavailable or symbol unresolved',
  };
}

module.exports = {
  fetchExchangePriceSnapshot,
  buildCandidates,
};
