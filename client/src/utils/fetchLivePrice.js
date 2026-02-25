/**
 * Fetch a fresh live last-price for a symbol directly from the exchange's public REST API.
 * Called client-side right before alert creation so `currentPrice` is always up-to-date.
 * Returns a number or null (never throws).
 */

async function tryFetch(url) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBinanceFuturesPrice(symbol) {
  // Try fapi first, then www.binance.com/fapi as fallback
  for (const base of ['https://fapi.binance.com/fapi/v1', 'https://www.binance.com/fapi/v1']) {
    try {
      const data = await tryFetch(`${base}/ticker/price?symbol=${encodeURIComponent(symbol)}`);
      const price = parseFloat(data?.price);
      if (Number.isFinite(price) && price > 0) return price;
    } catch {
      // try next base
    }
  }
  return null;
}

async function fetchBinanceSpotPrice(symbol) {
  try {
    const data = await tryFetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`
    );
    const price = parseFloat(data?.price);
    if (Number.isFinite(price) && price > 0) return price;
  } catch { /* ignore */ }
  return null;
}

async function fetchBybitPrice(symbol, market) {
  const category = market === 'spot' ? 'spot' : 'linear';
  try {
    const data = await tryFetch(
      `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${encodeURIComponent(symbol)}`
    );
    const price = parseFloat(data?.result?.list?.[0]?.lastPrice);
    if (Number.isFinite(price) && price > 0) return price;
  } catch { /* ignore */ }
  return null;
}

async function fetchOkxPrice(symbol, market) {
  // OKX instId format: BTC-USDT-SWAP (futures) or BTC-USDT (spot)
  const base = symbol.replace(/USDT$/i, '');
  const instId = market === 'spot' ? `${base}-USDT` : `${base}-USDT-SWAP`;
  try {
    const data = await tryFetch(
      `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`
    );
    const price = parseFloat(data?.data?.[0]?.last);
    if (Number.isFinite(price) && price > 0) return price;
  } catch { /* ignore */ }
  return null;
}

async function fetchGatePrice(symbol, market) {
  const base = symbol.replace(/USDT$/i, '');
  if (market === 'spot') {
    try {
      const data = await tryFetch(
        `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(`${base}_USDT`)}`
      );
      const price = parseFloat(Array.isArray(data) ? data[0]?.last : null);
      if (Number.isFinite(price) && price > 0) return price;
    } catch { /* ignore */ }
    return null;
  }
  // Futures
  try {
    const data = await tryFetch(
      `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${encodeURIComponent(`${base}_USDT`)}`
    );
    const price = parseFloat(Array.isArray(data) ? data[0]?.last : null);
    if (Number.isFinite(price) && price > 0) return price;
  } catch { /* ignore */ }
  return null;
}

async function fetchMexcPrice(symbol, market) {
  if (market === 'spot') {
    try {
      const data = await tryFetch(
        `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`
      );
      const price = parseFloat(data?.price);
      if (Number.isFinite(price) && price > 0) return price;
    } catch { /* ignore */ }
    return null;
  }
  // Futures: MEXC uses underscore format e.g. BTC_USDT
  const base = symbol.replace(/USDT$/i, '');
  try {
    const data = await tryFetch(
      `https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(`${base}_USDT`)}`
    );
    const price = parseFloat(data?.data?.lastPrice);
    if (Number.isFinite(price) && price > 0) return price;
  } catch { /* ignore */ }
  return null;
}

async function fetchBitgetPrice(symbol, market) {
  const base = symbol.replace(/USDT$/i, '');
  if (market === 'spot') {
    try {
      const data = await tryFetch(
        `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${encodeURIComponent(`${base}USDT_SPBL`)}`
      );
      const price = parseFloat(data?.data?.close);
      if (Number.isFinite(price) && price > 0) return price;
    } catch { /* ignore */ }
    return null;
  }
  // Futures
  try {
    const data = await tryFetch(
      `https://api.bitget.com/api/mix/v1/market/ticker?symbol=${encodeURIComponent(`${base}USDT_UMCBL`)}`
    );
    const price = parseFloat(data?.data?.last);
    if (Number.isFinite(price) && price > 0) return price;
  } catch { /* ignore */ }
  return null;
}

/**
 * Fetch current live price for a symbol from the given exchange and market.
 * @param {string} exchange  - 'binance' | 'bybit' | 'okx' | 'gate' | 'mexc' | 'bitget'
 * @param {string} market    - 'futures' | 'spot'
 * @param {string} symbol    - e.g. 'BTCUSDT'
 * @returns {Promise<number|null>} - Live price or null if unavailable
 */
export async function fetchLivePrice(exchange, market, symbol) {
  if (!exchange || !symbol) return null;
  const ex = String(exchange).toLowerCase();
  const sym = String(symbol).toUpperCase();

  try {
    switch (ex) {
      case 'binance':
        return market === 'spot'
          ? await fetchBinanceSpotPrice(sym)
          : await fetchBinanceFuturesPrice(sym);
      case 'bybit':
        return await fetchBybitPrice(sym, market);
      case 'okx':
        return await fetchOkxPrice(sym, market);
      case 'gate':
        return await fetchGatePrice(sym, market);
      case 'mexc':
        return await fetchMexcPrice(sym, market);
      case 'bitget':
        return await fetchBitgetPrice(sym, market);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
