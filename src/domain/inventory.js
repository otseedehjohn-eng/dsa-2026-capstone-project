import { DomainError } from './errors.js';
import { newId, newReference } from './ids.js';
import { Queue } from './waitlistQueue.js';

function invalid(message) {
  throw new DomainError('VALIDATION', message);
}

function requireStore(store) {
  if (
    store === null
    || typeof store !== 'object'
    || !(store.events instanceof Map)
    || !(store.bookingsByReference instanceof Map)
  ) {
    invalid('A valid store is required.');
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalid(`${label} must be a positive whole number.`);
  }
}

function requireValidEventDate(value) {
  if (typeof value !== 'string' || value.length === 0) {
    invalid('Event date must be an ISO date string.');
  }

  const datePrefix = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!datePrefix) {
    invalid('Event date must be a valid ISO date or datetime.');
  }

  const [, year, month, day] = datePrefix;
  const parsedDate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== Number(year)
    || parsedDate.getUTCMonth() + 1 !== Number(month)
    || parsedDate.getUTCDate() !== Number(day)
  ) {
    invalid('Event date must contain a real calendar date.');
  }

  if (value.length === 10) {
    return;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    invalid('Event date must be a valid ISO date or datetime.');
  }
}

function requireMapKey(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${label} must be a non-empty string.`);
  }
}

function findEvent(store, eventId) {
  requireMapKey(eventId, 'Event id');
  const event = store.events.get(eventId);

  if (!event) {
    throw new DomainError('NOT_FOUND', `Event "${eventId}" was not found.`);
  }

  return event;
}

function findTier(event, tierId) {
  requireMapKey(tierId, 'Tier id');
  const tier = event.tiers.get(tierId);

  if (!tier) {
    throw new DomainError('NOT_FOUND', `Ticket tier "${tierId}" was not found.`);
  }

  return tier;
}

export function createStore() {
  return {
    events: new Map(),
    bookingsByReference: new Map(),
  };
}

export function createEvent(store, details = {}) {
  requireStore(store);
  requireObject(details, 'Event details');
  const { title, city, venue, date } = details;
  const validatedTitle = requireNonEmptyString(title, 'Event title');
  const validatedCity = requireNonEmptyString(city, 'Event city');
  const validatedVenue = requireNonEmptyString(venue, 'Event venue');
  requireValidEventDate(date);

  const event = {
    id: newId(),
    title: validatedTitle,
    city: validatedCity,
    venue: validatedVenue,
    date,
    published: false,
    tiers: new Map(),
  };

  store.events.set(event.id, event);
  return event;
}

export function addTier(store, eventId, details = {}) {
  requireStore(store);
  const event = findEvent(store, eventId);
  requireObject(details, 'Tier details');
  const { name, priceCents, capacity } = details;
  const validatedName = requireNonEmptyString(name, 'Tier name');

  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    invalid('Tier price must be a non-negative whole number of cents.');
  }
  requirePositiveInteger(capacity, 'Tier capacity');

  const tier = {
    id: newId(),
    name: validatedName,
    priceCents,
    capacity,
    sold: 0,
    seatsLeft: capacity,
    waitlist: new Queue(),
  };

  event.tiers.set(tier.id, tier);
  return tier;
}

export function bookTickets(store, eventId, tierId, attendeeName, quantity) {
  requireStore(store);
  const event = findEvent(store, eventId);
  const tier = findTier(event, tierId);
  const validatedAttendeeName = requireNonEmptyString(attendeeName, 'Attendee name');

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    invalid('Ticket quantity must be a whole number from 1 to 10.');
  }

  const totalCents = tier.priceCents * quantity;
  if (!Number.isSafeInteger(totalCents)) {
    invalid('Booking total must be a safe whole number of cents.');
  }

  if (tier.seatsLeft < quantity) {
    throw new DomainError('SOLD_OUT', 'There are not enough seats left in this tier.');
  }

  const booking = {
    id: newId(),
    reference: uniqueReference(store),
    eventId,
    tierId,
    attendeeName: validatedAttendeeName,
    quantity,
    totalCents,
    status: 'pending',
  };

  tier.sold += quantity;
  tier.seatsLeft -= quantity;
  store.bookingsByReference.set(booking.reference, booking);
  return booking;
}

function uniqueReference(store) {
  let reference = newReference();
  while (store.bookingsByReference.has(reference)) {
    reference = newReference();
  }
  return reference;
}

export function cancelBooking(store, reference) {
  requireStore(store);
  requireMapKey(reference, 'Booking reference');
  const booking = store.bookingsByReference.get(reference);

  if (!booking) {
    throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
  }
  if (booking.status === 'cancelled') {
    throw new DomainError('INVALID_STATE', 'This booking has already been cancelled.');
  }

  const event = findEvent(store, booking.eventId);
  const tier = findTier(event, booking.tierId);

  booking.status = 'cancelled';
  tier.sold -= booking.quantity;
  tier.seatsLeft += booking.quantity;
  return booking;
}

export function findBookingByReference(store, reference) {
  requireStore(store);
  requireMapKey(reference, 'Booking reference');
  return store.bookingsByReference.get(reference) ?? null;
}

export function joinWaitlist(store, eventId, tierId, attendeeName) {
  requireStore(store);
  const event = findEvent(store, eventId);
  const tier = findTier(event, tierId);
  const validatedAttendeeName = requireNonEmptyString(attendeeName, 'Attendee name');

  if (tier.seatsLeft > 0) {
    throw new DomainError('NOT_SOLD_OUT', 'Join the waitlist only when the tier is sold out.');
  }

  const entry = {
    id: newId(),
    attendeeName: validatedAttendeeName,
  };
  tier.waitlist.enqueue(entry);
  return entry;
}
