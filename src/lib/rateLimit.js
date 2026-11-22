import { DomainError } from '../domain/errors.js';

const DEFAULT_MAX_ENTRIES = 10_000;

export function createRateLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
  maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError('Rate limit must be a positive whole number.');
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('Rate-limit window must be a positive whole number of milliseconds.');
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('Rate-limit entry capacity must be a positive whole number.');
  }

  const attempts = new Map();

  return {
    consume(key) {
      if (typeof key !== 'string' || key.trim() === '') {
        throw new TypeError('A client IP address is required for rate limiting.');
      }

      const timestamp = now();
      if (!Number.isFinite(timestamp)) {
        throw new TypeError('Rate-limit clock must return a finite timestamp.');
      }
      const windowStart = Math.floor(timestamp / windowMs) * windowMs;
      const current = attempts.get(key);
      if (!current || current.windowStart !== windowStart) {
        if (attempts.size >= maxEntries) {
          const oldestKey = attempts.keys().next().value;
          if (oldestKey !== undefined) attempts.delete(oldestKey);
        }
        attempts.set(key, { windowStart, count: 1 });
        return;
      }

      if (current.count >= limit) {
        throw new DomainError('RATE_LIMITED', 'Too many attempts. Please try again later.');
      }
      current.count += 1;
    },
  };
}

