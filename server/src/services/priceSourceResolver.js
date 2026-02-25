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
    // Symbol has no quote suffix — try common quote currencies so 'BTC' → ['BTC','BTCUSDT','BTCUSD'].
    set.add(`${normalizedBase}USDT`);
    set.add(`${normalizedBase}USD`);
  }
  // When symbol already ends in USDT/USD (e.g. 'XUSDT', 'BTCUSDT'), do NOT add the
  // bare base ('X', 'BTC') as a candidate.  The bare string is often not a real
  // symbol on the exchange, so Binance returns 400 for it — burning 2 weight units
  // per call per alert per 300ms cycle, rapidly exhausting the IP rate limit
  // (2400 weight/min), triggering 429 → 15-second error cooldown → all alerts
  // silently skipped.

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

async function fetchExchangePriceSnapshot({ exchange, market, symbol, strict = true, exchangeOnly, logger = console }) {
  const exchangeKey = String(exchange || '').toLowerCase();
  const service = getExchangeService(exchangeKey, { allowDefault: false });
  const normalizedMarket = String(market || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
  const exchangeType = normalizedMarket === 'spot' ? 'spot' : 'futures';

  // exchangeOnly controls CoinGecko fallback independently from strict (error handling).
  // Callers can set exchangeOnly:true + strict:false to use the efficient cached bulk
  // ticker without CoinGecko, while still failing gracefully (ok:false) on errors.
  const useExchangeOnly = typeof exchangeOnly === 'boolean' ? exchangeOnly : (strict === true);

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

  // Per-symbol REST (fetchCurrentPriceBySymbol) is ONLY used in strict:true mode
  // (alert creation — called once per alert).
  //
  // In strict:false mode (the 300ms engine polling path) this block is SKIPPED.
  // Why: fetchCurrentPriceBySymbol makes one individual HTTP call to Binance per
  // candidate symbol.  With N active alerts, that is N individual REST calls every
  // 300ms → N × 3.3 calls/sec.  Binance weight: 2 per /ticker/price call.
  // At just 6 active alerts: 6 × 3.3 × 2 = ~40 weight/sec = 2400 weight/min — the
  // EXACT Binance IP rate limit.  Any additional traffic causes 429 → binanceService
  // starts a 15-second error cooldown → ALL alerts are silently skipped for 15s →
  // cycle repeats indefinitely.  The bulk cached ticker below (getLastPricesBySymbols)
  // fetches prices for ALL symbols in ONE call cached for 2 seconds — zero per-alert
  // overhead regardless of how many alerts are active.
  if (strict && typeof service.fetchCurrentPriceBySymbol === 'function') {
    for (const candidate of candidates) {
      try {
        const directPrice = Number(
          await service.fetchCurrentPriceBySymbol(candidate, exchangeType, {
            strict,
            exchangeOnly: useExchangeOnly,
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
      exchangeOnly: useExchangeOnly,
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
