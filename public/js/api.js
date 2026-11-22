import { mockBookings, mockEvents } from './mockData.js';

const HOLD_DURATION_MS = 10 * 60 * 1000;
let nextBookingNumber = 1;

function apiError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.error = { code, message };
  return error;
}

function eventCopy(event) {
  return {
    ...event,
    tiers: event.tiers.map((tier) => ({ ...tier })),
  };
}

function bookingCopy(booking) {
  const { holdExpiresAt, ...result } = booking;
  return result;
}

function expirePendingBookings() {
  const now = Date.now();
  for (const booking of mockBookings) {
    if (booking.status !== 'pending' || Date.parse(booking.holdExpiresAt) > now) continue;
    const event = mockEvents.find(({ id }) => id === booking.eventId);
    const tier = event?.tiers.find(({ id }) => id === booking.tierId);
    if (tier) {
      tier.sold -= booking.quantity;
      tier.seatsLeft += booking.quantity;
    }
    booking.status = 'cancelled';
  }
}

function compareEvents(left, right, sortBy) {
  let comparison = 0;
  if (sortBy === 'price') {
    const leftPrice = Math.min(...left.tiers.map(({ priceCents }) => priceCents));
    const rightPrice = Math.min(...right.tiers.map(({ priceCents }) => priceCents));
    comparison = leftPrice - rightPrice;
  } else if (sortBy === 'availability') {
    const leftSeats = left.tiers.reduce((sum, tier) => sum + tier.seatsLeft, 0);
    const rightSeats = right.tiers.reduce((sum, tier) => sum + tier.seatsLeft, 0);
    comparison = rightSeats - leftSeats;
  } else if (sortBy === 'date') {
    comparison = Date.parse(left.date) - Date.parse(right.date);
  } else {
    throw apiError('VALIDATION', `Unknown event sort option "${sortBy}".`);
  }

  return comparison
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

export async function listEvents({
  q = '',
  city = '',
  maxPriceCents,
  sort = 'date',
} = {}) {
  expirePendingBookings();
  if (!['date', 'price', 'availability'].includes(sort)) {
    throw apiError('VALIDATION', `Unknown event sort option "${sort}".`);
  }
  if (maxPriceCents !== undefined && (!Number.isSafeInteger(maxPriceCents) || maxPriceCents < 0)) {
    throw apiError('VALIDATION', 'Maximum price must be a non-negative whole number of cents.');
  }

  const query = String(q).trim().toLocaleLowerCase();
  const requestedCity = String(city).trim().toLocaleLowerCase();
  const events = mockEvents.filter((event) => {
    if (!event.published) return false;
    if (query && !`${event.title} ${event.venue}`.toLocaleLowerCase().includes(query)) return false;
    if (requestedCity && event.city.toLocaleLowerCase() !== requestedCity) return false;
    if (maxPriceCents !== undefined) {
      if (event.tiers.length === 0) return false;
      if (Math.min(...event.tiers.map(({ priceCents }) => priceCents)) > maxPriceCents) return false;
    }
    return true;
  });

  return events
    .slice()
    .sort((left, right) => compareEvents(left, right, sort))
    .map(eventCopy);
}

export async function getEvent(eventId) {
  expirePendingBookings();
  const event = mockEvents.find((item) => item.id === eventId && item.published);
  if (!event) throw apiError('NOT_FOUND', `Event "${eventId}" was not found.`);
  return eventCopy(event);
}

export async function createBooking({
  eventId,
  tierId,
  attendeeName,
  quantity,
} = {}) {
  expirePendingBookings();
  const event = mockEvents.find((item) => item.id === eventId && item.published);
  if (!event) throw apiError('NOT_FOUND', `Event "${eventId}" was not found.`);
  const tier = event.tiers.find((item) => item.id === tierId);
  if (!tier) throw apiError('NOT_FOUND', `Ticket tier "${tierId}" was not found.`);
  if (typeof attendeeName !== 'string' || attendeeName.trim() === '') {
    throw apiError('VALIDATION', 'Attendee name must be a non-empty string.');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    throw apiError('VALIDATION', 'Ticket quantity must be a whole number from 1 to 10.');
  }
  if (tier.seatsLeft < quantity) {
    throw apiError('SOLD_OUT', 'There are not enough seats left in this tier.');
  }

  const totalCents = tier.priceCents * quantity;
  if (!Number.isSafeInteger(totalCents)) {
    throw apiError('VALIDATION', 'Booking total must be a safe whole number of cents.');
  }
  const booking = {
    id: `mock-booking-${nextBookingNumber}`,
    reference: `MOCK-${String(nextBookingNumber).padStart(4, '0')}`,
    userId: 'mock-attendee',
    eventId,
    tierId,
    attendeeName: attendeeName.trim(),
    quantity,
    totalCents,
    status: 'pending',
    holdExpiresAt: new Date(Date.now() + HOLD_DURATION_MS).toISOString(),
  };
  nextBookingNumber += 1;
  tier.sold += quantity;
  tier.seatsLeft -= quantity;
  mockBookings.push(booking);
  return bookingCopy(booking);
}

export async function getHoldExpiry(reference) {
  expirePendingBookings();
  const booking = mockBookings.find((item) => item.reference === reference);
  if (!booking) throw apiError('NOT_FOUND', `Booking "${reference}" was not found.`);
  return booking.holdExpiresAt;
}

export async function pay(reference, { decline = false } = {}) {
  expirePendingBookings();
  const booking = mockBookings.find((item) => item.reference === reference);
  if (!booking) throw apiError('NOT_FOUND', `Booking "${reference}" was not found.`);
  if (booking.status !== 'pending') {
    throw apiError('INVALID_TRANSITION', `Booking cannot be paid from "${booking.status}".`);
  }
  if (typeof decline !== 'boolean') {
    throw apiError('VALIDATION', 'decline must be a boolean.');
  }
  if (decline) {
    throw apiError('PAYMENT_DECLINED', 'The mock payment was declined.');
  }

  booking.status = 'paid';
  return bookingCopy(booking);
}
