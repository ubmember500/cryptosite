/**
 * Shared kline resampling utilities.
 *
 * Converts 1-minute OHLCV candles into sub-minute (1 s / 5 s / 15 s) candles
 * using a Brownian-bridge algorithm that looks realistic while remaining fully
 * deterministic (seeded PRNG).
 *
 * Used by:
 *   – client-side marketStore (initial history + scroll-back)
 *   – server-side exchange WS adapters (fallback when trade stream unavailable)
 */

'use strict';

// ---------------------------------------------------------------------------
// Deterministic LCG pseudo-random number generator
// ---------------------------------------------------------------------------

/**
 * Linear Congruential Generator – returns values in [0, 1).
 * @param {number} seed - Integer seed
 * @returns {Function} Generator function returning pseudorandom [0,1)
 */
function _lcg(seed) {
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
 * Resample a **single** 1-minute candle into N sub-candles.
 *
 * Algorithm (Brownian bridge with reflecting boundaries):
 *   1. Build a price path of N+1 points from open → close.
 *   2. Each step is a Gaussian-ish increment scaled to range / √N.
 *   3. Two randomly-chosen points are forced to touch high and low,
 *      with directional bias (bullish → low early / high late).
 *   4. All points are clamped to [low, high] using soft reflection.
 *   5. Consecutive pairs become sub-candle open/close; small natural wicks
 *      are added within parent bounds.
 *   6. Volume follows a U-shaped distribution (heavier at the edges of the
 *      minute, lighter in the middle) so the total is preserved.
 *
 * @param {Object}   kline1m          Single 1-minute candle
 * @param {string}   secondInterval   '1s' | '5s' | '15s'
 * @returns {Array}  Array of sub-candles
 */
function resample1mToSeconds(kline1m, secondInterval) {
  const spanSec = { '1s': 1, '5s': 5, '15s': 15 }[secondInterval];
  if (!spanSec) return Array.isArray(kline1m) ? kline1m : [kline1m];

  const N = 60 / spanSec; // 60, 12, or 4

  // Accept both single-candle and array-of-candles forms
  const candles = Array.isArray(kline1m) ? kline1m : [kline1m];
  const result = [];

  for (const candle of candles) {
    const { open, high, low, close, volume, isClosed: parentClosed } = candle;
    const candleTime = Number(candle.time);
    const range = high - low;
    const volTotal = Number(volume) || 0;

    // --- trivial case: flat candle ----------------------------------------
    if (range === 0 || !Number.isFinite(range)) {
      for (let i = 0; i < N; i++) {
        result.push({
          time: candleTime + i * spanSec,
          open,
          high,
          low,
          close,
          volume: volTotal / N,
          isClosed: parentClosed && i === N - 1,
        });
      }
      continue;
    }

    const rng = _lcg(candleTime * 7 + spanSec);

    // --- choose anchor positions for high & low --------------------------
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

    // --- Brownian-bridge path from open → close --------------------------
    const prices = new Array(N + 1);
    prices[0] = open;
    prices[N] = close;

    // Step volatility ≈ range / √N  (scaled by 0.6 to stay within bounds)
    const sigma = range / Math.sqrt(N) * 0.6;

    // Forward pass: random walk with drift toward close
    for (let i = 1; i < N; i++) {
      const remaining = N - i;
      // Bridge drift: pull toward the final value
      const drift = (close - prices[i - 1]) / remaining;
      // Box-Muller-ish: cheap 2-uniform → pseudo-Gaussian
      const u1 = Math.max(1e-10, rng());
      const u2 = rng();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      let p = prices[i - 1] + drift + sigma * gauss * Math.sqrt(1 / remaining);
      // Soft reflection within [low, high]
      if (p > high) p = high - (p - high) * 0.5;
      if (p < low) p = low + (low - p) * 0.5;
      // Hard clamp
      p = Math.min(high, Math.max(low, p));
      prices[i] = p;
    }

    // Force high / low at the chosen anchor indices
    prices[hiIdx] = high;
    prices[loIdx] = low;

    // --- smooth neighbours of forced anchors to avoid jumps ---------------
    const smoothNeighbour = (idx, val) => {
      if (idx > 1) {
        prices[idx - 1] = prices[idx - 1] * 0.5 + val * 0.5;
        prices[idx - 1] = Math.min(high, Math.max(low, prices[idx - 1]));
      }
      if (idx < N - 1) {
        prices[idx + 1] = prices[idx + 1] * 0.5 + val * 0.5;
        prices[idx + 1] = Math.min(high, Math.max(low, prices[idx + 1]));
      }
    };
    smoothNeighbour(hiIdx, high);
    smoothNeighbour(loIdx, low);

    // Restore endpoints (smoothing above doesn't touch 0 / N directly, but
    // the neighbour logic might have shifted index 1 or N-1 slightly).
    prices[0] = open;
    prices[N] = close;

    // --- U-shaped volume distribution ------------------------------------
    // w(i) = 1 + cos(2π·(i+0.5)/N) → peaks at i≈0 and i≈N-1
    let volWeights = new Array(N);
    let wSum = 0;
    for (let i = 0; i < N; i++) {
      const w = 1 + Math.cos(2 * Math.PI * (i + 0.5) / N);
      volWeights[i] = w;
      wSum += w;
    }

    // --- assemble sub-candles --------------------------------------------
    for (let i = 0; i < N; i++) {
      const sO = prices[i];
      const sC = prices[i + 1];
      const bodyHi = Math.max(sO, sC);
      const bodyLo = Math.min(sO, sC);
      // Natural wicks – small random extension, still within parent bounds
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { _lcg, resample1mToSeconds };
