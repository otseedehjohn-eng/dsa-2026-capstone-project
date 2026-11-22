import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/http/app.js';
import { registerApiRoutes } from '../src/http/apiRoutes.js';
import { createDatabase } from '../src/db/connection.js';
import { DomainError } from '../src/domain/errors.js';
import { calculateRefund } from '../src/domain/refundPolicy.js';
import {
  BOOKING_HOLD_DURATION_MS,
  createClock,
  WAITLIST_OFFER_DURATION_MS,
} from '../src/lib/clock.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { signToken } from '../src/lib/token.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { createMaintenance } from '../src/jobs/maintenance.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createEventService } from '../src/services/eventService.js';
import { createSeatService } from '../src/services/seatService.js';
import { createWaitlistService } from '../src/services/waitlistService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_SECRET = 'build-eight-tests-use-a-long-secret-32-bytes';

function assertDomainCode(operation, code) {
  return assert.rejects(operation, (error) => (
    error instanceof DomainError && error.code === code
  ));
}

function createSystem(context, { capacity = 1, startInDays = 10 } = {}) {
  const database = createDatabase(':memory:');
  context.after(() => database.close());
  const repository = createSqliteRepository(database);
  const clock = createClock('2027-01-01T00:00:00.000Z');
  const start = new Date(clock.now().getTime() + startInDays * DAY_MS).toISOString();
  const eventService = createEventService(repository);
  const seatService = createSeatService(repository);
  const waitlistService = createWaitlistService(repository, { clock });
  const gateway = createMockPaymentGateway();
  const refunds = [];
  const paymentGateway = {
    charge: gateway.charge,
    async refund(request) {
      refunds.push(request);
      return gateway.refund(request);
    },
  };
  const bookingService = createBookingService(repository, paymentGateway, {
    clock,
    seatService,
    waitlistService,
  });
  const maintenance = createMaintenance({
    repository,
    bookingService,
    waitlistService,
    clock,
  });

  return {
    repository,
    clock,
    eventService,
    waitlistService,
    bookingService,
    maintenance,
    refunds,
    async createEvent() {
      const event = await eventService.create('organizer-build-8', {
        title: 'Build Eight Test',
        city: 'Lagos',
        venue: 'Test Hall',
        date: start,
      });
      const tier = await eventService.addTier('organizer-build-8', event.id, {
        name: 'General',
        priceCents: 101,
        capacity,
      });
      await eventService.publish('organizer-build-8', event.id);
      return { event, tier };
    },
    async createWaitlistUser(id) {
      return repository.saveUser({
        id,
        name: id,
        email: `${id}@example.test`,
        role: 'attendee',
        passwordHash: 'test-hash',
      });
    },
  };
}

async function startApi(context, { eventService, bookingService, waitlistService }) {
  const server = createApp({
    configureRouter(router) {
      registerApiRoutes(router, eventService, bookingService, TOKEN_SECRET, waitlistService);
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function tokenFor(id) {
  return signToken({
    sub: id,
    email: `${id}@example.test`,
    role: 'attendee',
  }, TOKEN_SECRET);
}

async function apiRequest(baseUrl, path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('database startup migrates existing Build 7 booking tables', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ticketing-build-8-'));
  const databasePath = path.join(directory, 'ticketing.sqlite');
  const previousDatabase = new DatabaseSync(databasePath);
  previousDatabase.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL,
      title TEXT NOT NULL,
      city TEXT NOT NULL,
      venue TEXT NOT NULL,
      date TEXT NOT NULL,
      published INTEGER NOT NULL
    );
    CREATE TABLE ticket_tiers (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      sold INTEGER NOT NULL
    );
    CREATE TABLE bookings (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      attendee_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      tier_id TEXT NOT NULL,
      attendee_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL
    );
  `);
  previousDatabase.close();

  const database = createDatabase(databasePath);
  try {
    const bookingColumns = database.prepare('PRAGMA table_info(bookings)').all()
      .map((column) => column.name);
    assert.ok(bookingColumns.includes('refunded_cents'));
    assert.ok(bookingColumns.includes('hold_expires_at'));
    assert.ok(bookingColumns.includes('hold_expired'));
    assert.ok(bookingColumns.includes('checked_in_at'));
    assert.ok(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get('waitlist_offers'));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refund policy handles every boundary and rejects started events', () => {
  const start = Date.parse('2027-01-20T00:00:00.000Z');
  assert.equal(calculateRefund({
    amountCents: 101,
    startsAt: start,
    now: start - 7 * DAY_MS,
  }), 101);
  assert.equal(calculateRefund({
    amountCents: 101,
    startsAt: start,
    now: start - (6 * DAY_MS + 23 * 60 * 60 * 1000),
  }), 50);
  assert.equal(calculateRefund({
    amountCents: 101,
    startsAt: start,
    now: start - 2 * DAY_MS,
  }), 50);
  assert.equal(calculateRefund({
    amountCents: 101,
    startsAt: start,
    now: start - (DAY_MS + 23 * 60 * 60 * 1000),
  }), 0);
  assert.throws(
    () => calculateRefund({ amountCents: 101, startsAt: start, now: start }),
    (error) => error instanceof DomainError && error.code === 'EVENT_STARTED',
  );
});

test('paid cancellation refunds and compare-and-set releases seats only once', async (context) => {
  const system = createSystem(context);
  const { event, tier } = await system.createEvent();
  const booking = await system.bookingService.book('attendee-paid', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Ada',
    quantity: 1,
  });
  await system.bookingService.pay('attendee-paid', booking.reference);

  const results = await Promise.allSettled([
    system.bookingService.cancel('attendee-paid', booking.reference),
    system.bookingService.cancel('attendee-paid', booking.reference),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'INVALID_TRANSITION');
  assert.deepEqual(system.refunds, [{ amountCents: 101, reference: booking.reference }]);
  assert.equal((await system.repository.findBooking(booking.reference)).status, 'refunded');
  assert.equal((await system.repository.findTier(event.id, tier.id)).sold, 0);
});

test('paid cancellation within two days issues a zero refund and still releases the seat', async (context) => {
  const system = createSystem(context, { startInDays: 1 });
  const { event, tier } = await system.createEvent();
  const booking = await system.bookingService.book('attendee-no-refund', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Ada',
    quantity: 1,
  });
  await system.bookingService.pay('attendee-no-refund', booking.reference);

  const cancelled = await system.bookingService.cancel('attendee-no-refund', booking.reference);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.refundedCents, 0);
  assert.deepEqual(system.refunds, [{ amountCents: 0, reference: booking.reference }]);
  assert.equal((await system.repository.findTier(event.id, tier.id)).sold, 0);
  system.clock.advance(BOOKING_HOLD_DURATION_MS);
  await assertDomainCode(
    system.bookingService.pay('attendee-no-refund', booking.reference),
    'INVALID_TRANSITION',
  );
});

test('waitlist offers seats in FIFO order, expires to the next person, and acceptance holds inventory', async (context) => {
  const system = createSystem(context);
  const { event, tier } = await system.createEvent();
  for (const id of ['waiter-a', 'waiter-b', 'waiter-c']) {
    await system.createWaitlistUser(id);
  }
  await assertDomainCode(
    system.waitlistService.join('waiter-a', {
      eventId: event.id,
      tierId: tier.id,
      attendeeName: 'A',
    }),
    'NOT_SOLD_OUT',
  );
  const booking = await system.bookingService.book('attendee-original', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Original',
    quantity: 1,
  });
  for (const [id, attendeeName] of [
    ['waiter-a', 'A'],
    ['waiter-b', 'B'],
    ['waiter-c', 'C'],
  ]) {
    await system.waitlistService.join(id, {
      eventId: event.id,
      tierId: tier.id,
      attendeeName,
    });
  }
  await assertDomainCode(
    system.waitlistService.join('waiter-a', {
      eventId: event.id,
      tierId: tier.id,
      attendeeName: 'A',
    }),
    'ALREADY_ON_WAITLIST',
  );
  await system.bookingService.cancel('attendee-original', booking.reference);

  const firstOffers = await system.waitlistService.listOffers('waiter-a');
  assert.equal(firstOffers.length, 1);
  assert.equal(firstOffers[0].id, (await system.repository.findWaitlistOffer(
    firstOffers[0].id,
  )).id);
  assert.deepEqual(await system.waitlistService.listOffers('waiter-b'), []);
  assert.equal((await system.repository.findTier(event.id, tier.id)).sold, 1);

  system.clock.advance(WAITLIST_OFFER_DURATION_MS);
  assert.equal(await system.waitlistService.processExpiredOffers(), 1);
  await assertDomainCode(
    system.waitlistService.accept(firstOffers[0].id, 'waiter-a'),
    'OFFER_EXPIRED',
  );
  const secondOffers = await system.waitlistService.listOffers('waiter-b');
  assert.equal(secondOffers.length, 1);
  assert.equal(secondOffers[0].tierId, tier.id);
  assert.deepEqual(await system.waitlistService.listOffers('waiter-c'), []);

  const accepted = await system.waitlistService.accept(secondOffers[0].id, 'waiter-b');
  assert.equal(accepted.status, 'pending');
  assert.equal(accepted.quantity, 1);
  assert.equal((await system.repository.findTier(event.id, tier.id)).sold, 1);
  await assertDomainCode(system.bookingService.book('new-attendee', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Late',
    quantity: 1,
  }), 'SOLD_OUT');
});

test('multiple freed seats are held one per attendee in FIFO order', async (context) => {
  const system = createSystem(context, { capacity: 3 });
  const { event, tier } = await system.createEvent();
  for (const id of ['waiter-one', 'waiter-two', 'waiter-three']) {
    await system.createWaitlistUser(id);
  }
  const booking = await system.bookingService.book('attendee-group', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Group',
    quantity: 3,
  });
  for (const [id, attendeeName] of [
    ['waiter-one', 'One'],
    ['waiter-two', 'Two'],
    ['waiter-three', 'Three'],
  ]) {
    await system.waitlistService.join(id, { eventId: event.id, tierId: tier.id, attendeeName });
  }

  await system.bookingService.cancel('attendee-group', booking.reference);
  const offers = await Promise.all([
    system.waitlistService.listOffers('waiter-one'),
    system.waitlistService.listOffers('waiter-two'),
    system.waitlistService.listOffers('waiter-three'),
  ]);
  assert.deepEqual(offers.map((items) => items.length), [1, 1, 1]);
  assert.equal((await system.repository.findTier(event.id, tier.id)).sold, 3);
});

test('maintenance expires unpaid holds, offers released seats, and never expires paid bookings', async (context) => {
  const system = createSystem(context, { capacity: 2 });
  const { event, tier } = await system.createEvent();
  await system.createWaitlistUser('waiter-expiry');
  const pending = await system.bookingService.book('attendee-pending', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Pending',
    quantity: 1,
  });
  const paid = await system.bookingService.book('attendee-paid', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Paid',
    quantity: 1,
  });
  await system.bookingService.pay('attendee-paid', paid.reference);
  await system.waitlistService.join('waiter-expiry', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Waiter',
  });

  system.clock.advance(BOOKING_HOLD_DURATION_MS);
  assert.deepEqual(await system.maintenance.run(), {
    bookingsCancelled: 1,
    offersExpired: 0,
  });
  assert.equal((await system.repository.findBooking(pending.reference)).status, 'cancelled');
  assert.equal((await system.repository.findBooking(pending.reference)).holdExpired, true);
  assert.equal((await system.repository.findBooking(paid.reference)).status, 'paid');
  assert.equal((await system.repository.findTier(event.id, tier.id)).sold, 2);
  assert.equal((await system.waitlistService.listOffers('waiter-expiry')).length, 1);
  await assertDomainCode(
    system.bookingService.pay('attendee-pending', pending.reference),
    'BOOKING_EXPIRED',
  );
});

test('Build 8 API exposes refund previews, waitlist join, offers, and acceptance', async (context) => {
  const system = createSystem(context);
  const { event, tier } = await system.createEvent();
  await system.createWaitlistUser('attendee-waiter-api');
  const baseUrl = await startApi(context, system);
  const waiterToken = tokenFor('attendee-waiter-api');
  const notSoldOut = await apiRequest(baseUrl, '/api/waitlist', {
    token: waiterToken,
    method: 'POST',
    body: { eventId: event.id, tierId: tier.id, attendeeName: 'Waiter' },
  });
  assert.equal(notSoldOut.status, 409);
  assert.equal((await notSoldOut.json()).error.code, 'NOT_SOLD_OUT');

  const booking = await system.bookingService.book('attendee-original', {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Original',
    quantity: 1,
  });
  await system.bookingService.pay('attendee-original', booking.reference);

  const joinPath = '/api/waitlist';
  const joined = await apiRequest(baseUrl, joinPath, {
    token: waiterToken,
    method: 'POST',
    body: { eventId: event.id, tierId: tier.id, attendeeName: 'Waiter' },
  });
  assert.equal(joined.status, 201);
  const duplicate = await apiRequest(baseUrl, joinPath, {
    token: waiterToken,
    method: 'POST',
    body: { eventId: event.id, tierId: tier.id, attendeeName: 'Waiter' },
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'ALREADY_ON_WAITLIST');

  const attendeeToken = tokenFor('attendee-original');
  const quote = await apiRequest(baseUrl, `/api/bookings/${booking.reference}/refund`, {
    token: attendeeToken,
  });
  assert.equal(quote.status, 200);
  assert.equal((await quote.json()).refundCents, 101);
  const cancelled = await apiRequest(baseUrl, `/api/bookings/${booking.reference}/cancel`, {
    token: attendeeToken,
    method: 'POST',
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).refundedCents, 101);

  const offersResponse = await apiRequest(baseUrl, '/api/waitlist/offers', {
    token: waiterToken,
  });
  const [offer] = await offersResponse.json();
  assert.equal(offersResponse.status, 200);
  assert.equal(offer.quantity, 1);
  const accepted = await apiRequest(baseUrl, `/api/waitlist/${offer.id}/accept`, {
    token: waiterToken,
    method: 'POST',
  });
  assert.equal(accepted.status, 200);
  const bookingFromOffer = await accepted.json();
  assert.equal(bookingFromOffer.status, 'pending');

  system.clock.advance(BOOKING_HOLD_DURATION_MS);
  const expiredPayment = await apiRequest(baseUrl, `/api/bookings/${bookingFromOffer.reference}/pay`, {
    token: waiterToken,
    method: 'POST',
    body: { decline: false },
  });
  assert.equal(expiredPayment.status, 409);
  assert.equal((await expiredPayment.json()).error.code, 'BOOKING_EXPIRED');
});
