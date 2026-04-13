const crypto = require('crypto');
const { redisGetJson, redisSetJson } = require('./redis-cache');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE = new Map();
const INFLIGHT = new Map();

function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (input) => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map(walk);
    return Object.keys(input).sort().reduce((acc, key) => {
      acc[key] = walk(input[key]);
      return acc;
    }, {});
  };
  return JSON.stringify(walk(value));
}

function hashParts(parts) {
  const raw = Array.isArray(parts) ? stableStringify(parts) : stableStringify([parts]);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getCachedValue(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue(key, value, ttlMs = DEFAULT_TTL_MS) {
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function cachedAsync(parts, producer, ttlMs = DEFAULT_TTL_MS) {
  const key = hashParts(parts);
  const cached = getCachedValue(key);
  if (cached !== null) return cached;
  const redisCached = await redisGetJson(`creative-portal:ai-cache:${key}`);
  if (redisCached !== null) {
    setCachedValue(key, redisCached, ttlMs);
    return redisCached;
  }
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);

  const promise = (async () => {
    try {
      const value = await producer();
      setCachedValue(key, value, ttlMs);
      void redisSetJson(`creative-portal:ai-cache:${key}`, value, ttlMs);
      return value;
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, promise);
  return promise;
}

module.exports = {
  cachedAsync,
  hashParts,
  stableStringify,
};
