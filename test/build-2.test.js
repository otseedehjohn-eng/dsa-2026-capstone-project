import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../src/domain/errors.js';
import {
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  joinWaitlist,
  listEventSummaries,
  publishEvent,
  unpublishEvent,
} from '../src/domain/inventory.js';
import { filterEvents, searchEvents, sortEvents } from '../src/domain/eventSearch.js';
import { mergeSort } from '../src/domain/sorting.js';

function assertDomainCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, code);
    return true;
  });
}

function createExampleEvent(store, details = {}) {
  return createEvent(store, {
    title: 'Lagos Tech Meetup',
    city: 'Lagos',
    venue: 'Civic Centre',
    date: '2026-12-05T17:00:00Z',
    ...details,
  });
}

function summary({
  id,
  title,
  city = 'Lagos',
  venue = 'Civic Centre',
  date = '2026-12-05T17:00:00Z',
  tiers = [{ priceCents: 5000, seatsLeft: 2 }],
}) {
  return { id, title, city, venue, date, tiers };
}

test('S02: created events are saved as drafts with a new id and hidden publicly', () => {
  const store = createStore();
  const event = createExampleEvent(store);

  assert.ok(event.id);
  assert.equal(event.published, false);
  assert.equal(store.events.get(event.id), event);
  assert.deepEqual(listEventSummaries(store), []);
  assert.equal(listEventSummaries(store, { publishedOnly: false })[0].id, event.id);
});

test('S02: missing required fields or an unreal date rejects without saving', () => {
  for (const details of [
    { title: '', city: 'Lagos', venue: 'Hall', date: '2026-12-05' },
    { title: 'Show', city: '', venue: 'Hall', date: '2026-12-05' },
    { title: 'Show', city: 'Lagos', venue: 'Hall', date: '2026-02-30' },
  ]) {
    const store = createStore();
    assertDomainCode(() => createEvent(store, details), 'VALIDATION');
    assert.equal(store.events.size, 0);
  }
});

test('S03: a tier stores its whole-cent price, capacity, sold count, and seats left', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  const tier = addTier(store, event.id, { name: 'General', priceCents: 500000, capacity: 100 });

  assert.equal(tier.priceCents, 500000);
  assert.equal(tier.capacity, 100);
  assert.equal(tier.sold, 0);
  assert.equal(tier.seatsLeft, 100);
});

test('S03: fractional prices and capacities below one reject with VALIDATION', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  assertDomainCode(() => addTier(store, event.id, { name: 'General', priceCents: 1.5, capacity: 2 }), 'VALIDATION');
  assertDomainCode(() => addTier(store, event.id, { name: 'General', priceCents: 100, capacity: 0 }), 'VALIDATION');
});

test('S03: adding a tier to a missing event rejects with NOT_FOUND', () => {
  assertDomainCode(
    () => addTier(createStore(), 'missing', { name: 'General', priceCents: 100, capacity: 2 }),
    'NOT_FOUND',
  );
});

test('S04: publishing a tiered draft exposes it in the public summaries', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  addTier(store, event.id, { name: 'General', priceCents: 2500, capacity: 20 });

  publishEvent(store, event.id);
  assert.equal(event.published, true);
  assert.equal(listEventSummaries(store)[0].id, event.id);
});

test('S04: publishing an event without tiers rejects and leaves it a draft', () => {
  const store = createStore();
  const event = createExampleEvent(store);

  assertDomainCode(() => publishEvent(store, event.id), 'INVALID_STATE');
  assert.equal(event.published, false);
  assert.deepEqual(listEventSummaries(store), []);
});

test('S04: unpublishing hides an event from public summaries', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  addTier(store, event.id, { name: 'General', priceCents: 2500, capacity: 20 });
  publishEvent(store, event.id);

  unpublishEvent(store, event.id);
  assert.equal(event.published, false);
  assert.deepEqual(listEventSummaries(store), []);
});

test('S05: text search matches title or venue without case sensitivity', () => {
  const events = [
    summary({ id: '1', title: 'Lagos Tech Meetup' }),
    summary({ id: '2', title: 'Abuja Jazz Night', venue: 'National Theatre' }),
  ];
  assert.deepEqual(filterEvents(events, { q: 'JAZZ' }).map((event) => event.id), ['2']);
  assert.deepEqual(filterEvents(events, { q: 'CIVIC' }).map((event) => event.id), ['1']);
});

test('S05: city filtering is exact apart from letter case', () => {
  const events = [
    summary({ id: '1', title: 'Meetup', city: 'Lagos' }),
    summary({ id: '2', title: 'Jazz', city: 'Abuja' }),
    summary({ id: '3', title: 'Elsewhere', city: 'Greater Lagos' }),
  ];
  assert.deepEqual(filterEvents(events, { city: 'lagos' }).map((event) => event.id), ['1']);
});

test('S05: maximum price uses the cheapest tier, sorts cheapest first, and excludes no-tier events', () => {
  const events = [
    summary({ id: '1', title: 'No tier', tiers: [] }),
    summary({ id: '2', title: 'Affordable', tiers: [{ priceCents: 4000, seatsLeft: 1 }] }),
    summary({ id: '3', title: 'Mixed', tiers: [{ priceCents: 9000, seatsLeft: 1 }, { priceCents: 3000, seatsLeft: 1 }] }),
    summary({ id: '4', title: 'Too costly', tiers: [{ priceCents: 7000, seatsLeft: 1 }] }),
  ];

  assert.deepEqual(searchEvents(events, { maxPriceCents: 5000 }, 'price').map((event) => event.id), ['3', '2']);
});

test('S05: date sorting breaks same-day ties by title and then id', () => {
  const events = [
    summary({ id: 'z', title: 'Beta', date: '2026-12-05T19:00:00Z' }),
    summary({ id: '2', title: 'Alpha', date: '2026-12-05T18:00:00Z' }),
    summary({ id: '1', title: 'Alpha', date: '2026-12-05T18:00:00Z' }),
    summary({ id: '0', title: 'Earlier', date: '2026-12-04T20:00:00Z' }),
  ];

  assert.deepEqual(sortEvents(events, 'date').map((event) => event.id), ['0', '1', '2', 'z']);
});

test('S05: a date-only upper bound includes events throughout that day', () => {
  const events = [
    summary({ id: '1', title: 'Afternoon', date: '2026-12-05T17:00:00Z' }),
    summary({ id: '2', title: 'Next day', date: '2026-12-06T00:00:00Z' }),
  ];
  assert.deepEqual(filterEvents(events, { from: '2026-12-05', to: '2026-12-05' }).map((event) => event.id), ['1']);
});

test('S05: invalid dates, fractional prices, and unknown sort options reject with VALIDATION', () => {
  const events = [summary({ id: '1', title: 'Event' })];
  assertDomainCode(() => filterEvents(events, { from: '2026-02-30' }), 'VALIDATION');
  assertDomainCode(() => filterEvents(events, { maxPriceCents: 12.5 }), 'VALIDATION');
  assertDomainCode(() => searchEvents(events, {}, 'random'), 'VALIDATION');
});

test('S05: filtering and sorting do not mutate the source list; empty inputs work', () => {
  const events = [
    summary({ id: '2', title: 'Zulu' }),
    summary({ id: '1', title: 'Alpha' }),
  ];
  const original = structuredClone(events);

  assert.deepEqual(filterEvents(events, { city: 'lagos' }).map((event) => event.id), ['2', '1']);
  assert.deepEqual(sortEvents(events, 'date').map((event) => event.id), ['1', '2']);
  assert.deepEqual(events, original);
  assert.deepEqual(filterEvents([], { q: 'none' }), []);
  assert.deepEqual(sortEvents([], 'price'), []);
  assert.deepEqual(searchEvents([], {}, 'availability'), []);
});

test('S05: availability sorts by seats left then title and id', () => {
  const events = [
    summary({ id: '3', title: 'Beta', tiers: [{ priceCents: 100, seatsLeft: 4 }] }),
    summary({ id: '2', title: 'Alpha', tiers: [{ priceCents: 100, seatsLeft: 4 }] }),
    summary({ id: '1', title: 'Sold out', tiers: [{ priceCents: 100, seatsLeft: 0 }] }),
  ];
  assert.deepEqual(sortEvents(events, 'availability').map((event) => event.id), ['2', '3', '1']);
  assert.deepEqual(filterEvents(events, { onlyAvailable: true }).map((event) => event.id), ['3', '2']);
});

test('S06: booking creates a pending whole-cent booking and decrements seats', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  const tier = addTier(store, event.id, { name: 'General', priceCents: 5000, capacity: 3 });
  publishEvent(store, event.id);
  const booking = bookTickets(store, event.id, tier.id, 'Attendee', 2);

  assert.equal(booking.status, 'pending');
  assert.equal(booking.quantity, 2);
  assert.equal(booking.totalCents, 10000);
  assert.equal(tier.seatsLeft, 1);
});

test('S06: booking beyond remaining capacity rejects with SOLD_OUT and changes nothing', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  const tier = addTier(store, event.id, { name: 'General', priceCents: 5000, capacity: 1 });
  const before = { sold: tier.sold, seatsLeft: tier.seatsLeft, bookings: store.bookingsByReference.size };

  assertDomainCode(() => bookTickets(store, event.id, tier.id, 'Attendee', 2), 'SOLD_OUT');
  assert.deepEqual({ sold: tier.sold, seatsLeft: tier.seatsLeft, bookings: store.bookingsByReference.size }, before);
});

test('S06: quantities outside one through ten whole tickets reject with VALIDATION', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  const tier = addTier(store, event.id, { name: 'General', priceCents: 5000, capacity: 20 });

  for (const quantity of [0, -1, 1.5, 11]) {
    assertDomainCode(() => bookTickets(store, event.id, tier.id, 'Attendee', quantity), 'VALIDATION');
  }
});

test('mergeSort returns a stable new array without mutating its input', () => {
  const items = [
    { key: 1, order: 'first' },
    { key: 0, order: 'middle' },
    { key: 1, order: 'last' },
  ];
  const original = structuredClone(items);
  const sorted = mergeSort(items, (left, right) => left.key - right.key);

  assert.notStrictEqual(sorted, items);
  assert.deepEqual(sorted.map((item) => item.order), ['middle', 'first', 'last']);
  assert.deepEqual(items, original);
});

test('mergeSort rejects invalid arguments with VALIDATION', () => {
  assertDomainCode(() => mergeSort('not an array', () => 0), 'VALIDATION');
  assertDomainCode(() => mergeSort([], null), 'VALIDATION');
});

test('domain error paths preserve their codes and error type', () => {
  const store = createStore();
  const event = createExampleEvent(store);
  const tier = addTier(store, event.id, { name: 'General', priceCents: 100, capacity: 1 });
  bookTickets(store, event.id, tier.id, 'Attendee', 1);
  assertDomainCode(() => bookTickets(store, event.id, tier.id, 'Another', 1), 'SOLD_OUT');
  assertDomainCode(() => publishEvent(store, 'missing'), 'NOT_FOUND');
  assertDomainCode(() => joinWaitlist(store, event.id, tier.id, 'Attendee'), 'NOT_SOLD_OUT');
  const booking = [...store.bookingsByReference.values()][0];
  cancelBooking(store, booking.reference);
  assertDomainCode(() => cancelBooking(store, booking.reference), 'INVALID_STATE');
});
