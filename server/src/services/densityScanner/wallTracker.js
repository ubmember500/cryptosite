/**
 * WallTracker — Persistent wall identity & age tracking.
 *
 * Tracks order-book walls across scan cycles so we can compute wall "age"
 * (how long a wall has persisted). Uses logarithmic price bucketing with
 * adjacent-bucket search for robust cross-scan matching even when grouped
 * wall prices drift slightly.
 *
 * Bucketing: Math.round(ln(price) × 1000) → each bucket ≈ 0.1% of price.
 * This gives uniform relative resolution regardless of absolute price
 * ($0.70 tokens and $71,000 BTC both get ~0.1% buckets).
 *
 * Matching: checks ±3 adjacent buckets (≈ 0.3% tolerance) to find the
 * same wall when its grouped price shifts between scans.
 *
 * @module densityScanner/wallTracker
 */

const MAX_TRACKED_WALLS = 50000;
const STALE_WALL_TTL_MS = 10 * 60 * 1000; // 10 minutes – remove walls not seen for this long
const MATCH_BUCKET_RADIUS = 3;             // ±3 buckets ≈ ±0.3% price tolerance
const PRICE_MATCH_TOLERANCE = 0.003;       // 0.3% — verify stored price is within this

class WallTracker {
  constructor() {
    /** @type {Map<string, object>} trackingKey → wallRecord */
    this.activeWalls = new Map();
  }

  /**
   * Generate a tracking key using logarithmic price bucketing.
   * Each bucket spans approximately 0.1% of the price, giving uniform
   * relative precision across all price ranges.
   *
   * @param {string} exchange
   * @param {string} symbol
   * @param {string} side
   * @param {number} price
   * @returns {string}
   */
  _makeTrackingKey(exchange, symbol, side, price) {
    const bucket = Math.round(Math.log(price) * 1000);
    return `${exchange}:${symbol}:${side}:${bucket}`;
  }

  /**
   * Find an existing tracked wall that matches a newly detected wall.
   *
   * Uses logarithmic bucketing: checks the exact bucket plus ±3 adjacent
   * buckets (each ~0.1% of price, so ±3 = ~0.3% tolerance). This is just
   * 7 Map.get() calls — fast and deterministic.
   *
   * @param {string} exchange
   * @param {string} symbol
   * @param {string} side
   * @param {number} price
   * @returns {{ key: string, record: object } | null}
   */
  _findMatchingWall(exchange, symbol, side, price) {
    const centerBucket = Math.round(Math.log(price) * 1000);
    const prefix = `${exchange}:${symbol}:${side}:`;

    // Step 1: exact bucket (fast path)
    const exactKey = `${prefix}${centerBucket}`;
    const exactRecord = this.activeWalls.get(exactKey);
    if (exactRecord) {
      return { key: exactKey, record: exactRecord };
    }

    // Step 2: check adjacent buckets within ±MATCH_BUCKET_RADIUS
    let bestMatch = null;
    let bestDiff = Infinity;

    for (let offset = -MATCH_BUCKET_RADIUS; offset <= MATCH_BUCKET_RADIUS; offset++) {
      if (offset === 0) continue;
      const key = `${prefix}${centerBucket + offset}`;
      const record = this.activeWalls.get(key);
      if (record) {
        const diff = Math.abs(record.price - price) / price;
        if (diff <= PRICE_MATCH_TOLERANCE && diff < bestDiff) {
          bestDiff = diff;
          bestMatch = { key, record };
        }
      }
    }

    return bestMatch;
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
        const record = match.record;

        // If this bucket was already updated in THIS SAME batch (same timestamp),
        // only replace if the incoming wall has a LARGER volumeUSD.
        // This prevents big walls from being overwritten by smaller walls
        // that happen to fall into the same log-bucket.
        if (record.lastSeenAt === now && wall.volumeUSD <= record.volumeUSD) {
          continue; // skip — keep the bigger wall in this bucket
        }

        // Update existing wall
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
