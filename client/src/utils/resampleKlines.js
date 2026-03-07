/**
 * Shared kline resampling utilities (client-side ES module).
 *
 * Converts 1-minute OHLCV candles into sub-minute (1 s / 5 s / 15 s) candles
 * using a Brownian-bridge algorithm that looks realistic while remaining fully
 * deterministic (seeded PRNG).
 *
 * The algorithm is identical to server/src/utils/resampleKlines.js so that
 * client-resampled history and server-resampled realtime candles are visually
 * consistent.
 */

// ---------------------------------------------------------------------------
// Deterministic LCG pseudo-random number generator
// ---------------------------------------------------------------------------
export function _lcg(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ---------------------------------------------------------------------------
// Brownian-bridge resampling
// ---------------------------------------------------------------------------

/**
 * Resample 1-minute candle(s) into sub-minute candles.
 * Accepts either a single candle object or an array.
 *
 * @param {Object|Array} kline1m        Single candle or array of 1m candles
 * @param {string}       secondInterval '1s' | '5s' | '15s'
 * @returns {Array}      Array of sub-candles
 */
export function resample1mToSeconds(kline1m, secondInterval) {
  const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  if (!spanSec) return Array.isArray(kline1m) ? kline1m : [kline1m];

  const N = 60 / spanSec;
  const candles = Array.isArray(kline1m) ? kline1m : [kline1m];
  const result = [];

  for (const candle of candles) {
    const { open, high, low, close, volume, isClosed: parentClosed } = candle;
    const candleTime = Number(candle.time);
    const range = high - low;
    const volTotal = Number(volume) || 0;

    if (range === 0 || !Number.isFinite(range)) {
      for (let i = 0; i < N; i++) {
        result.push({
          time: candleTime + i * spanSec,
          open, high, low, close,
          volume: volTotal / N,
          isClosed: parentClosed && i === N - 1,
        });
      }
      continue;
    }

    const rng = _lcg(candleTime * 7 + spanSec);

    // Choose anchor positions for high & low
    const isGreen = close >= open;
    const halfN = Math.max(1, Math.floor(N / 2));
    let hiIdx, loIdx;
    if (isGreen) {
      loIdx = 1 + Math.floor(rng() * halfN);
      hiIdx = halfN + Math.floor(rng() * (N - halfN));
    } else {
      hiIdx = 1 + Math.floor(rng() * halfN);
      loIdx = halfN + Math.floor(rng() * (N - halfN));
    }
    hiIdx = Math.min(hiIdx, N - 1);
    loIdx = Math.min(loIdx, N - 1);
    if (hiIdx === loIdx) {
      hiIdx = Math.min(hiIdx + 1, N - 1);
      if (hiIdx === loIdx) loIdx = Math.max(1, loIdx - 1);
    }

    // Brownian-bridge path from open → close
    const prices = new Array(N + 1);
    prices[0] = open;
    prices[N] = close;
    const sigma = range / Math.sqrt(N) * 0.6;

    for (let i = 1; i < N; i++) {
      const remaining = N - i;
      const drift = (close - prices[i - 1]) / remaining;
      const u1 = Math.max(1e-10, rng());
      const u2 = rng();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      let p = prices[i - 1] + drift + sigma * gauss * Math.sqrt(1 / remaining);
      if (p > high) p = high - (p - high) * 0.5;
      if (p < low) p = low + (low - p) * 0.5;
      p = Math.min(high, Math.max(low, p));
      prices[i] = p;
    }

    prices[hiIdx] = high;
    prices[loIdx] = low;

    // Smooth neighbours of forced anchors
    const smooth = (idx, val) => {
      if (idx > 1) {
        prices[idx - 1] = Math.min(high, Math.max(low, prices[idx - 1] * 0.5 + val * 0.5));
      }
      if (idx < N - 1) {
        prices[idx + 1] = Math.min(high, Math.max(low, prices[idx + 1] * 0.5 + val * 0.5));
      }
    };
    smooth(hiIdx, high);
    smooth(loIdx, low);
    prices[0] = open;
    prices[N] = close;

    // U-shaped volume distribution
    let volWeights = new Array(N);
    let wSum = 0;
    for (let i = 0; i < N; i++) {
      const w = 1 + Math.cos(2 * Math.PI * (i + 0.5) / N);
      volWeights[i] = w;
      wSum += w;
    }

    // Assemble sub-candles
    for (let i = 0; i < N; i++) {
      const sO = prices[i];
      const sC = prices[i + 1];
      const bodyHi = Math.max(sO, sC);
      const bodyLo = Math.min(sO, sC);
      const wickUp = range * (0.001 + rng() * 0.025);
      const wickDn = range * (0.001 + rng() * 0.025);
      result.push({
        time: candleTime + i * spanSec,
        open: sO,
        high: Math.min(high, bodyHi + wickUp),
        low: Math.max(low, bodyLo - wickDn),
        close: sC,
        volume: volTotal * (volWeights[i] / wSum),
        isClosed: parentClosed && i === N - 1,
      });
    }
  }

  return result;
}
