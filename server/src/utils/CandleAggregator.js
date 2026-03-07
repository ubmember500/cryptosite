/**
 * CandleAggregator
 *
 * Aggregates real-time trade ticks into OHLCV candles aligned to wall-clock
 * second boundaries (1 s, 5 s, or 15 s).
 *
 * Usage:
 *   const agg = new CandleAggregator(5);          // 5-second candles
 *   agg.on('candle', (candle) => { ... });         // live update (throttled)
 *   agg.on('closed', (candle) => { ... });         // candle finalized
 *   agg.addTrade({ price: 68012.5, quantity: 0.15, timestampMs: 1741234567890 });
 */

'use strict';

const { EventEmitter } = require('events');

// Maximum emit rate per interval (throttles update events)
const EMIT_INTERVAL_MS = {
  1: 250,   // 1s candles: emit at most 4×/s
  5: 500,   // 5s candles: 2×/s
  15: 1000, // 15s candles: 1×/s
};

class CandleAggregator extends EventEmitter {
  /**
   * @param {number} spanSeconds - Candle span: 1, 5, or 15.
   */
  constructor(spanSeconds) {
    super();

    if (![1, 5, 15].includes(spanSeconds)) {
      throw new Error(`CandleAggregator: unsupported span ${spanSeconds}s`);
    }

    this.spanSeconds = spanSeconds;
    this.spanMs = spanSeconds * 1000;
    this.emitIntervalMs = EMIT_INTERVAL_MS[spanSeconds] || 250;

    /** @type {{ time:number, open:number, high:number, low:number, close:number, volume:number }|null} */
    this.current = null;

    /** @type {number} timestamp of last candle-update emit */
    this._lastEmitTs = 0;

    /** @type {NodeJS.Timeout|null} trailing throttle timer */
    this._throttleTimer = null;

    /** Total trade count for the current candle (debugging) */
    this.tradeCount = 0;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Feed a trade into the aggregator.
   * @param {{ price: number, quantity: number, timestampMs: number }} trade
   */
  addTrade(trade) {
    const { price, quantity, timestampMs } = trade;
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return;

    const ts = Number(timestampMs);
    // Determine wall-clock candle boundary (in seconds)
    // ts is in milliseconds, spanMs is in milliseconds → division gives interval count
    const candleTimeSec = Math.floor(ts / this.spanMs) * this.spanSeconds;

    // If we already have an open candle for a different time window, close it
    if (this.current && this.current.time !== candleTimeSec) {
      this._closeCurrentCandle();
    }

    // Start a new candle if needed
    if (!this.current) {
      this.current = {
        time: candleTimeSec,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: quantity,
      };
      this.tradeCount = 1;
      this._scheduleEmit();
      return;
    }

    // Update running candle
    if (price > this.current.high) this.current.high = price;
    if (price < this.current.low) this.current.low = price;
    this.current.close = price;
    this.current.volume += quantity;
    this.tradeCount++;

    this._scheduleEmit();
  }

  /**
   * Force-close the current candle (e.g. when unsubscribing).
   */
  flush() {
    if (this.current) {
      this._closeCurrentCandle();
    }
  }

  /**
   * Reset all state.
   */
  reset() {
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
    this.current = null;
    this.tradeCount = 0;
    this._lastEmitTs = 0;
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Emit the current candle (if any) immediately. */
  _emitCandleUpdate() {
    if (!this.current) return;
    this._lastEmitTs = Date.now();
    this.emit('candle', { ...this.current, isClosed: false });
  }

  /** Close the current candle, emit 'closed', and clear state. */
  _closeCurrentCandle() {
    if (!this.current) return;

    // Cancel any pending throttle
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }

    const closed = { ...this.current, isClosed: true };
    this.emit('closed', closed);
    // Also emit as a regular candle update so listeners that only subscribe
    // to 'candle' still receive the final version.
    this.emit('candle', closed);
    this.current = null;
    this.tradeCount = 0;
  }

  /** Throttle-aware emit scheduler. */
  _scheduleEmit() {
    const now = Date.now();
    const elapsed = now - this._lastEmitTs;

    if (elapsed >= this.emitIntervalMs) {
      // Enough time has passed — emit immediately
      this._emitCandleUpdate();
      return;
    }

    // Schedule a trailing emit if one isn't already pending
    if (!this._throttleTimer) {
      this._throttleTimer = setTimeout(() => {
        this._throttleTimer = null;
        this._emitCandleUpdate();
      }, this.emitIntervalMs - elapsed);
    }
  }
}

module.exports = CandleAggregator;
