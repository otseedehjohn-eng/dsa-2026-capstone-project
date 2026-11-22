import { DomainError } from './errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function timestamp(value, label) {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(result)) {
    throw new DomainError('VALIDATION', `${label} must be a valid date.`);
  }
  return result;
}

export function calculateRefund({ amountCents, startsAt, now } = {}) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new DomainError('VALIDATION', 'Refund amount must be a non-negative whole number of cents.');
  }

  const startsAtMs = timestamp(startsAt, 'Event start');
  const nowMs = timestamp(now, 'Current time');
  const timeUntilStart = startsAtMs - nowMs;

  if (timeUntilStart <= 0) {
    throw new DomainError('EVENT_STARTED', 'A booking cannot be cancelled after the event has started.');
  }
  if (timeUntilStart >= 7 * DAY_MS) return amountCents;
  if (timeUntilStart >= 2 * DAY_MS) return Math.floor(amountCents * 0.5);
  return 0;
}
