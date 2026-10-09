/**
 * In-memory token buckets. No timers: buckets refill lazily when checked.
 * @param {{capacity:number, perSecond:number}} o
 */
export function createLimiter({ capacity, perSecond }) {
  const buckets = new Map();
  return function take(key, cost = 1) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: capacity, at: now }; buckets.set(key, b); }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    if (buckets.size > 20000) for (const [k, v] of buckets) { if (now - v.at > 600_000) buckets.delete(k); }
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  };
}
