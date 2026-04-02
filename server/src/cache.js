/** Simple in-memory TTL cache for fast repeat dashboard loads */

const store = new Map();

/**
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function getOrSet(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    return hit.value;
  }
  const value = await fn();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

export function invalidate(keyPrefix) {
  for (const k of store.keys()) {
    if (k.startsWith(keyPrefix)) store.delete(k);
  }
}
