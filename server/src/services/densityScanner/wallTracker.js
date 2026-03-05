/**
 * WallTracker — Persistent wall identity & age tracking.
 *
 * Tracks order-book walls across scan cycles so we can compute wall "age"
 * (how long a wall has persisted). Uses price-proximity matching to identify
 * the same wall even if its exact price drifts slightly between scans.
 *
 * @module densityScanner/wallTracker
 */

const MAX_TRACKED_WALLS = 50000;
const STALE_WALL_TTL_MS = 10 * 60 * 1000; // 10 minutes – remove walls not seen for this long
const PRICE_MATCH_TOLERANCE = 0.0015; // 0.15% tolerance for matching same wall across scans

class WallTracker {
  constructor() {
    /** @type {Map<string, object>} trackingKey → wallRecord */
    this.activeWalls = new Map();
  }

  /**
   * Generate a coarse tracking key for fast lookup.
   * Uses exchange + symbol + side + rounded price.
   * The price is rounded to 3 significant figures to create "buckets".
   *
   * @param {string} exchange
   * @param {string} symbol
   * @param {string} side
   * @param {number} price
   * @returns {string}
   */
  _makeTrackingKey(exchange, symbol, side, price) {
    const rounded = Number(price.toPrecision(3));
    return `${exchange}:${symbol}:${side}:${rounded}`;
  }

  /**
   * Find an existing tracked wall that matches a newly detected wall.
   * Searches activeWalls for same exchange + symbol + side where price
   * is within PRICE_MATCH_TOLERANCE (0.15%) of the existing wall.
   *
   * Uses a two-step approach:
   * 1. First try exact bucket lookup (fast O(1))
   * 2. If not found, try adjacent buckets (price ± tolerance)
   *
   * Returns the matching key + record, or null.
   *
   * @param {string} exchange
   * @param {string} symbol
   * @param {string} side
   * @param {number} price
   * @returns {{ key: string, record: object } | null}
   */
  _findMatchingWall(exchange, symbol, side, price) {
    // Step 1: exact bucket lookup
    const exactKey = this._makeTrackingKey(exchange, symbol, side, price);
    const exactRecord = this.activeWalls.get(exactKey);
    if (exactRecord) {
      return { key: exactKey, record: exactRecord };
    }

    // Step 2: try adjacent buckets by shifting price within tolerance
    const delta = PRICE_MATCH_TOLERANCE * price;
    const candidates = [];

    const priceLow = price - delta;
    const priceHigh = price + delta;

    const keyLow = this._makeTrackingKey(exchange, symbol, side, priceLow);
    const keyHigh = this._makeTrackingKey(exchange, symbol, side, priceHigh);

    // Deduplicate – if adjacent keys equal the exact key we already tried, skip
    const tried = new Set([exactKey]);

    if (!tried.has(keyLow)) {
      tried.add(keyLow);
      const rec = this.activeWalls.get(keyLow);
      if (rec) {
        // Verify the actual stored price is within tolerance of the incoming price
        const priceDiff = Math.abs(rec.price - price) / price;
        if (priceDiff <= PRICE_MATCH_TOLERANCE) {
          candidates.push({ key: keyLow, record: rec, diff: priceDiff });
        }
      }
    }

    if (!tried.has(keyHigh)) {
      tried.add(keyHigh);
      const rec = this.activeWalls.get(keyHigh);
      if (rec) {
        const priceDiff = Math.abs(rec.price - price) / price;
        if (priceDiff <= PRICE_MATCH_TOLERANCE) {
          candidates.push({ key: keyHigh, record: rec, diff: priceDiff });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // If multiple candidates match, prefer the one closest in price
    candidates.sort((a, b) => a.diff - b.diff);
    return { key: candidates[0].key, record: candidates[0].record };
  }

  /**
   * Process a batch of fresh walls from one scan cycle.
   *
   * For each wall in the new batch:
   *   - Try to find a matching existing wall (same exchange/symbol/side, price within 0.15%)
   *   - If found: update lastSeenAt, volumeUSD, price, volume, percentFromMid
   *   - If not found: create new entry with firstSeenAt = now
   *
   * After processing, any walls not seen (whose exchange matches one in the batch's
   * exchanges set + market) and whose lastSeenAt is older than STALE_WALL_TTL_MS
   * are removed.
   *
   * @param {Array} walls — array of wall objects from scanners:
   *   { exchange, symbol, originalSymbol, market, side, price, volume, volumeUSD, percentFromMid, midPrice }
   * @param {string} exchange — which exchange this batch is from (for stale cleanup scoping)
   * @param {string} market — which market type this batch is from
   */
  processWalls(walls, exchange, market) {
    const now = Date.now();

    // Process each new wall
    for (const wall of walls) {
      const match = this._findMatchingWall(wall.exchange, wall.symbol, wall.side, wall.price);

      if (match) {
        // Update existing wall
        const record = match.record;
        record.lastSeenAt = now;
        record.price = wall.price;
        record.volume = wall.volume;
        record.volumeUSD = wall.volumeUSD;
        record.percentFromMid = wall.percentFromMid;
        record.midPrice = wall.midPrice;
        record.scansSeen += 1;

        // If the matching key changed (price drifted), re-key
        const newKey = this._makeTrackingKey(wall.exchange, wall.symbol, wall.side, wall.price);
        if (match.key !== newKey) {
          this.activeWalls.delete(match.key);
          this.activeWalls.set(newKey, record);
        }
      } else {
        // Create new wall
        const key = this._makeTrackingKey(wall.exchange, wall.symbol, wall.side, wall.price);
        this.activeWalls.set(key, {
          exchange: wall.exchange,
          symbol: wall.symbol,
          originalSymbol: wall.originalSymbol,
          market: wall.market,
          side: wall.side,
          price: wall.price,
          volume: wall.volume,
          volumeUSD: wall.volumeUSD,
          percentFromMid: wall.percentFromMid,
          midPrice: wall.midPrice,
          firstSeenAt: now,
          lastSeenAt: now,
          scansSeen: 1,
        });
      }
    }

    // Remove stale walls for this exchange+market
    // Only remove walls that belong to the exchange+market we just scanned
    // (don't remove OKX walls just because Binance finished its scan)
    this._cleanupStaleWalls(exchange, market, now);

    // Enforce memory cap
    this._enforceMemoryCap();
  }

  /**
   * Remove walls for a specific exchange+market that haven't been seen
   * within STALE_WALL_TTL_MS.
   *
   * @param {string} exchange
   * @param {string} market
   * @param {number} now — current timestamp in ms
   */
  _cleanupStaleWalls(exchange, market, now) {
    for (const [key, entry] of this.activeWalls) {
      if (
        entry.exchange === exchange &&
        entry.market === market &&
        now - entry.lastSeenAt > STALE_WALL_TTL_MS
      ) {
        this.activeWalls.delete(key);
      }
    }
  }

  /**
   * If we exceed MAX_TRACKED_WALLS, remove the oldest/smallest walls.
   * Sort by volumeUSD ascending, remove smallest until under limit.
   * Removes down to 90% capacity to avoid constant eviction churn.
   */
  _enforceMemoryCap() {
    if (this.activeWalls.size <= MAX_TRACKED_WALLS) {
      return;
    }

    const targetSize = Math.floor(MAX_TRACKED_WALLS * 0.9);
    const entries = [...this.activeWalls.entries()];

    // Sort by volumeUSD ascending — smallest walls evicted first
    entries.sort((a, b) => a[1].volumeUSD - b[1].volumeUSD);

    const removeCount = entries.length - targetSize;
    for (let i = 0; i < removeCount; i++) {
      this.activeWalls.delete(entries[i][0]);
    }
  }

  /**
   * Get all active walls as an array, enriched with wallAgeMs.
   * @returns {Array} — wall objects with added `wallAgeMs` field (ms since first seen)
   */
  getAllWalls() {
    const now = Date.now();
    const walls = [];
    for (const record of this.activeWalls.values()) {
      walls.push({
        ...record,
        wallAgeMs: now - record.firstSeenAt,
      });
    }
    return walls;
  }

  /**
   * Get stats about the tracker.
   * @returns {{ totalTracked: number, byExchange: Record<string, number> }}
   */
  getStats() {
    const byExchange = {};
    for (const record of this.activeWalls.values()) {
      const key = `${record.exchange}_${record.market}`;
      byExchange[key] = (byExchange[key] || 0) + 1;
    }
    return {
      totalTracked: this.activeWalls.size,
      byExchange,
    };
  }
}

module.exports = { WallTracker };
