function toTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Clock time must be a valid date.');
  }
  return timestamp;
}

export function createClock(initialTime = Date.now()) {
  let timestamp = toTimestamp(initialTime);
  return {
    now() {
      return new Date(timestamp);
    },
    set(value) {
      timestamp = toTimestamp(value);
      return this.now();
    },
    advance(milliseconds) {
      if (!Number.isFinite(milliseconds)) {
        throw new TypeError('Clock advance must be a finite number of milliseconds.');
      }
      timestamp += milliseconds;
      return this.now();
    },
  };
}

export const systemClock = Object.freeze({
  now: () => new Date(),
});

export const BOOKING_HOLD_DURATION_MS = 10 * 60 * 1000;
export const WAITLIST_OFFER_DURATION_MS = 10 * 60 * 1000;
