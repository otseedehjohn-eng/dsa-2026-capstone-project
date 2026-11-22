import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/http/app.js';
import { registerApiRoutes } from '../src/http/apiRoutes.js';
import { createDatabase } from '../src/db/connection.js';
import { DomainError } from '../src/domain/errors.js';
import { createClock } from '../src/lib/clock.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createRateLimiter } from '../src/lib/rateLimit.js';
import { signToken } from '../src/lib/token.js';
import { verifyTicketToken } from '../src/lib/ticketToken.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createCheckinService } from '../src/services/checkinService.js';
import { createEventService } from '../src/services/eventService.js';

const JWT_SECRET = 'build-nine-login-secret-at-least-32-bytes';
const TICKET_SECRET = 'build-nine-different-ticket-secret-at-least-32-bytes';
const FUTURE_EVENT = '2027-02-01T10:00:00.000Z';

function assertDomainCode(operation, code) {
  return assert.rejects(operation, (error) => (
    error instanceof DomainError && error.code === code
  ));
}

function createSystem(context, { capacity = 3 } = {}) {
  const database = createDatabase(':memory:');
  context.after(() => database.close());
  const repository = createSqliteRepository(database);
  const clock = createClock('2027-01-01T00:00:00.000Z');
  const eventService = createEventService(repository);
  const bookingService = createBookingService(repository, createMockPaymentGateway(), { clock });
  const checkinService = createCheckinService(repository, TICKET_SECRET, { clock });

  return {
    repository,
    clock,
    eventService,
    bookingService,
    checkinService,
    async createEvent() {
      const event = await eventService.create('organizer-build-9', {
        title: 'Build Nine Test',
        city: 'Lagos',
        venue: 'Test Hall',
        date: FUTURE_EVENT,
      });
      const tier = await eventService.addTier('organizer-build-9', event.id, {
        name: 'General',
        priceCents: 5000,
        capacity,
      });
      await eventService.publish('organizer-build-9', event.id);
      return { event, tier };
    },
  };
}

function tokenFor(id, role) {
  return signToken({ sub: id, role }, JWT_SECRET);
}

async function startApi(context, {
  eventService,
  bookingService,
  checkinService,
  checkinRateLimiter,
} = {}) {
  const server = createApp({
    configureRouter(router) {
      registerApiRoutes(
        router,
        eventService,
        bookingService,
        JWT_SECRET,
        undefined,
        checkinService,
        checkinRateLimiter,
      );
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function apiRequest(baseUrl, pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createPaidBooking(system, eventId, tierId, attendeeId = 'attendee-build-9') {
  const booking = await system.bookingService.book(attendeeId, {
    eventId,
    tierId,
    attendeeName: 'Ada',
    quantity: 1,
  });
  await system.bookingService.pay(attendeeId, booking.reference);
  return booking;
}

test('ticket tokens contain only a booking reference and issue time and reject edits', async (context) => {
  const system = createSystem(context);
  const { event, tier } = await system.createEvent();
  const booking = await createPaidBooking(system, event.id, tier.id);
  const { ticketToken } = await system.checkinService.ticketForAttendee(
    'attendee-build-9',
    booking.reference,
  );
  const [encodedPayload, signature] = ticketToken.split('.');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

  assert.deepEqual(Object.keys(payload).sort(), ['iat', 'reference']);
  assert.equal(payload.reference, booking.reference);
  assert.equal(Number.isSafeInteger(payload.iat), true);
  assert.equal(verifyTicketToken(ticketToken, TICKET_SECRET).reference, booking.reference);
  assert.throws(
    () => verifyTicketToken(ticketToken, JWT_SECRET),
    (error) => error instanceof DomainError && error.code === 'INVALID',
  );

  const editedPayload = Buffer.from(JSON.stringify({
    reference: 'MADE-UP',
    iat: payload.iat,
  })).toString('base64url');
  const forged = `${editedPayload}.${signature}`;
  await assertDomainCode(
    system.checkinService.checkIn({ ticketToken: forged, eventId: event.id }),
    'INVALID',
  );
  await assertDomainCode(
    system.checkinService.checkIn({ ticketToken: 'made-up-code', eventId: event.id }),
    'INVALID',
  );
});

test('cancelled tickets and tickets presented at another event are rejected', async (context) => {
  const system = createSystem(context, { capacity: 4 });
  const { event, tier } = await system.createEvent();
  const cancelledBooking = await createPaidBooking(
    system,
    event.id,
    tier.id,
    'attendee-cancelled-ticket',
  );
  const { ticketToken: cancelledToken } = await system.checkinService.ticketForAttendee(
    'attendee-cancelled-ticket',
    cancelledBooking.reference,
  );
  await system.bookingService.cancel('attendee-cancelled-ticket', cancelledBooking.reference);
  await assertDomainCode(
    system.checkinService.checkIn({ ticketToken: cancelledToken, eventId: event.id }),
    'BOOKING_NOT_ACTIVE',
  );

  const activeBooking = await createPaidBooking(
    system,
    event.id,
    tier.id,
    'attendee-wrong-event',
  );
  const { ticketToken } = await system.checkinService.ticketForAttendee(
    'attendee-wrong-event',
    activeBooking.reference,
  );
  await assertDomainCode(
    system.checkinService.checkIn({ ticketToken, eventId: 'another-event' }),
    'WRONG_EVENT',
  );
  assert.equal((await system.repository.findBooking(activeBooking.reference)).status, 'paid');
});

test('two simultaneous scans admit exactly one staff member and record the first scan time', async (context) => {
  const system = createSystem(context);
  const { event, tier } = await system.createEvent();
  const booking = await createPaidBooking(system, event.id, tier.id);
  const { ticketToken } = await system.checkinService.ticketForAttendee(
    'attendee-build-9',
    booking.reference,
  );

  const results = await Promise.allSettled([
    system.checkinService.checkIn({ ticketToken, eventId: event.id }),
    system.checkinService.checkIn({ ticketToken, eventId: event.id }),
  ]);
  const admitted = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(admitted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'DUPLICATE_SCAN');
  assert.match(rejected[0].reason.message, /2027-01-01T00:00:00\.000Z/);

  const saved = await system.repository.findBooking(booking.reference);
  assert.equal(saved.status, 'checked_in');
  assert.equal(saved.checkedInAt, '2027-01-01T00:00:00.000Z');
});

test('API allows staff check-in, rejects other roles, and sends security headers', async (context) => {
  const system = createSystem(context);
  const { event, tier } = await system.createEvent();
  const booking = await createPaidBooking(system, event.id, tier.id);
  const { ticketToken } = await system.checkinService.ticketForAttendee(
    'attendee-build-9',
    booking.reference,
  );
  const baseUrl = await startApi(context, system);

  const ticketResponse = await apiRequest(
    baseUrl,
    `/api/bookings/${booking.reference}/ticket-token`,
    { token: tokenFor('attendee-build-9', 'attendee') },
  );
  assert.equal(ticketResponse.status, 200);
  assert.equal((await ticketResponse.json()).ticketToken, ticketToken);

  const wrongRole = await apiRequest(baseUrl, '/api/checkin', {
    method: 'POST',
    token: tokenFor('attendee-build-9', 'attendee'),
    body: { ticketToken, eventId: event.id },
  });
  assert.equal(wrongRole.status, 403);
  assert.equal(wrongRole.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(wrongRole.headers.get('referrer-policy'), 'no-referrer');
  assert.match(wrongRole.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(wrongRole.headers.get('content-security-policy'), /unsafe-inline/);

  const accepted = await apiRequest(baseUrl, '/api/checkin', {
    method: 'POST',
    token: tokenFor('staff-build-9', 'staff'),
    body: { ticketToken, eventId: event.id },
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).admitted, true);

  const duplicate = await apiRequest(baseUrl, '/api/checkin', {
    method: 'POST',
    token: tokenFor('staff-build-9', 'staff'),
    body: { ticketToken, eventId: event.id },
  });
  const duplicateResult = await duplicate.json();
  assert.equal(duplicate.status, 409);
  assert.equal(duplicateResult.error.code, 'DUPLICATE_SCAN');
  assert.match(duplicateResult.error.message, /2027-01-01T00:00:00\.000Z/);
});

test('login and check-in rate limiters reject repeated attempts per IP', async (context) => {
  let timestamp = 60_000;
  const limiter = createRateLimiter({
    limit: 1,
    windowMs: 60_000,
    now: () => timestamp,
  });
  limiter.consume('127.0.0.1');
  assert.throws(
    () => limiter.consume('127.0.0.1'),
    (error) => error instanceof DomainError && error.code === 'RATE_LIMITED',
  );
  timestamp += 60_000;
  assert.doesNotThrow(() => limiter.consume('127.0.0.1'));

  const loginLimiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  const server = createApp({
    configureRouter(router) {
      registerAuthRoutes(router, {
        async login() {
          return { success: true };
        },
        async signup() {
          return { success: true };
        },
        async me() {
          return {};
        },
      }, JWT_SECRET, loginLimiter);
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const credentials = { email: 'staff@example.test', password: 'not-used' };
  assert.equal((await apiRequest(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: credentials,
  })).status, 200);
  const limited = await apiRequest(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: credentials,
  });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED');

  const system = createSystem(context);
  const { event, tier } = await system.createEvent();
  const booking = await createPaidBooking(system, event.id, tier.id);
  const { ticketToken } = await system.checkinService.ticketForAttendee(
    'attendee-build-9',
    booking.reference,
  );
  const checkinLimiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  const checkinBaseUrl = await startApi(context, {
    ...system,
    checkinRateLimiter: checkinLimiter,
  });
  const firstScan = await apiRequest(checkinBaseUrl, '/api/checkin', {
    method: 'POST',
    token: tokenFor('staff-build-9', 'staff'),
    body: { ticketToken: 'invalid', eventId: event.id },
  });
  assert.equal(firstScan.status, 400);
  const secondScan = await apiRequest(checkinBaseUrl, '/api/checkin', {
    method: 'POST',
    token: tokenFor('staff-build-9', 'staff'),
    body: { ticketToken, eventId: event.id },
  });
  assert.equal(secondScan.status, 429);
});
