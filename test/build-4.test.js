import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/http/app.js';
import { registerApiRoutes } from '../src/http/apiRoutes.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createAuthService } from '../src/services/authService.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createEventService } from '../src/services/eventService.js';
import { signToken } from '../src/lib/token.js';

const TOKEN_SECRET = 'build-four-test-secret-at-least-32-bytes';

function tokenFor(userId) {
  const role = userId.startsWith('organizer-') ? 'organizer' : 'attendee';
  return signToken({ sub: userId, email: `${userId}@example.test`, role }, TOKEN_SECRET);
}

async function startApi(t) {
  const repository = createMemoryRepository();
  const paymentGateway = createMockPaymentGateway();
  let chargeCount = 0;
  let refundCount = 0;
  const gateway = {
    async charge(request) {
      chargeCount += 1;
      assert.equal(Object.hasOwn(request, 'cardNumber'), false);
      return paymentGateway.charge(request);
    },
    async refund(request) {
      refundCount += 1;
      assert.equal(Object.hasOwn(request, 'cardNumber'), false);
      return paymentGateway.refund(request);
    },
  };
  const eventService = createEventService(repository);
  const bookingService = createBookingService(repository, gateway);
  const authService = createAuthService(repository, TOKEN_SECRET);
  const server = createApp({
    configureRouter(router) {
      registerAuthRoutes(router, authService, TOKEN_SECRET);
      registerApiRoutes(router, eventService, bookingService, TOKEN_SECRET);
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    getChargeCount: () => chargeCount,
    getRefundCount: () => refundCount,
  };
}

async function request(baseUrl, route, { method = 'GET', userId, body } = {}) {
  const headers = {};
  if (userId) headers.authorization = `Bearer ${tokenFor(userId)}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  const result = await response.json();
  assert.deepEqual(Object.keys(result), ['error']);
  assert.deepEqual(Object.keys(result.error), ['code', 'message']);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, 'string');
}

test('real API supports event creation, search, booking, payment, and cancellation', async (t) => {
  const { baseUrl, getChargeCount, getRefundCount } = await startApi(t);
  const eventDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  await assertError(
    await request(baseUrl, '/api/events', {
      method: 'POST',
      body: { title: 'No caller' },
    }),
    401,
    'UNAUTHENTICATED',
  );

  const createdResponse = await request(baseUrl, '/api/events', {
    method: 'POST',
    userId: 'organizer-1',
    body: {
      title: 'Lagos Tech Meetup',
      city: 'Lagos',
      venue: 'Civic Centre',
      date: eventDate,
    },
  });
  assert.equal(createdResponse.status, 201);
  const event = await createdResponse.json();
  assert.equal(event.published, false);
  assert.deepEqual(event.tiers, []);
  assert.equal(Object.hasOwn(event, 'organizerId'), false);

  await assertError(
    await request(baseUrl, `/api/events/${event.id}/tiers`, {
      method: 'POST',
      userId: 'attendee-1',
      body: { name: 'General', priceCents: 5000, capacity: 3 },
    }),
    403,
    'FORBIDDEN',
  );

  await assertError(
    await request(baseUrl, `/api/events/${event.id}/publish`, {
      method: 'POST',
      userId: 'organizer-1',
    }),
    409,
    'INVALID_STATE',
  );

  const tierResponse = await request(baseUrl, `/api/events/${event.id}/tiers`, {
    method: 'POST',
    userId: 'organizer-1',
    body: { name: 'General', priceCents: 5000, capacity: 3 },
  });
  assert.equal(tierResponse.status, 201);
  const tier = await tierResponse.json();
  assert.equal(tier.seatsLeft, 3);
  assert.equal(Object.hasOwn(tier, 'waitlist'), false);

  const publishedResponse = await request(baseUrl, `/api/events/${event.id}/publish`, {
    method: 'POST',
    userId: 'organizer-1',
  });
  assert.equal(publishedResponse.status, 200);
  assert.equal((await publishedResponse.json()).published, true);

  const searchResponse = await request(
    baseUrl,
    `/api/events?q=TECH&city=lagos&from=${eventDate.slice(0, 10)}&to=${eventDate.slice(0, 10)}&maxPriceCents=5000&onlyAvailable=true&sort=price`,
  );
  assert.equal(searchResponse.status, 200);
  assert.deepEqual((await searchResponse.json()).map(({ id }) => id), [event.id]);

  const bookingResponse = await request(baseUrl, '/api/bookings', {
    method: 'POST',
    userId: 'attendee-1',
    body: { eventId: event.id, tierId: tier.id, attendeeName: 'Ada', quantity: 2 },
  });
  assert.equal(bookingResponse.status, 201);
  const booking = await bookingResponse.json();
  assert.equal(booking.status, 'pending');
  assert.equal(booking.totalCents, 10000);

  await assertError(
    await request(baseUrl, `/api/bookings/${booking.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-2',
      body: { decline: false },
    }),
    404,
    'NOT_FOUND',
  );

  await assertError(
    await request(baseUrl, `/api/bookings/${booking.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-1',
      body: { decline: true },
    }),
    402,
    'PAYMENT_DECLINED',
  );

  const paidResponse = await request(baseUrl, `/api/bookings/${booking.reference}/pay`, {
    method: 'POST',
    userId: 'attendee-1',
    body: { decline: false },
  });
  assert.equal(paidResponse.status, 200);
  assert.equal((await paidResponse.json()).status, 'paid');

  await assertError(
    await request(baseUrl, `/api/bookings/${booking.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-1',
      body: { decline: false },
    }),
    409,
    'INVALID_TRANSITION',
  );
  assert.equal(getChargeCount(), 2);

  const refundPreview = await request(baseUrl, `/api/bookings/${booking.reference}/refund`, {
    userId: 'attendee-1',
  });
  assert.equal((await refundPreview.json()).refundCents, booking.totalCents);
  const paidCancellation = await request(baseUrl, `/api/bookings/${booking.reference}/cancel`, {
    method: 'POST',
    userId: 'attendee-1',
  });
  assert.equal(paidCancellation.status, 200);
  assert.equal((await paidCancellation.json()).status, 'refunded');
  assert.equal(getRefundCount(), 1);
  await assertError(
    await request(baseUrl, `/api/bookings/${booking.reference}/cancel`, {
      method: 'POST',
      userId: 'attendee-1',
    }),
    409,
    'INVALID_TRANSITION',
  );

  const secondBookingResponse = await request(baseUrl, '/api/bookings', {
    method: 'POST',
    userId: 'attendee-1',
    body: { eventId: event.id, tierId: tier.id, attendeeName: 'Ada', quantity: 1 },
  });
  const secondBooking = await secondBookingResponse.json();
  const cancelledResponse = await request(
    baseUrl,
    `/api/bookings/${secondBooking.reference}/cancel`,
    { method: 'POST', userId: 'attendee-1' },
  );
  assert.equal(cancelledResponse.status, 200);
  assert.equal((await cancelledResponse.json()).status, 'cancelled');
  const availableAfterCancellation = await request(baseUrl, '/api/events?onlyAvailable=true');
  assert.deepEqual((await availableAfterCancellation.json()).map(({ id }) => id), [event.id]);

  await assertError(
    await request(baseUrl, `/api/bookings/${secondBooking.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-1',
      body: { decline: false },
    }),
    409,
    'INVALID_TRANSITION',
  );

  const unpublishResponse = await request(baseUrl, `/api/events/${event.id}/unpublish`, {
    method: 'POST',
    userId: 'organizer-1',
  });
  assert.equal((await unpublishResponse.json()).published, false);

  await assertError(
    await request(baseUrl, '/api/bookings', {
      method: 'POST',
      userId: 'attendee-1',
      body: { eventId: event.id, tierId: tier.id, attendeeName: 'Ada', quantity: 1 },
    }),
    409,
    'INVALID_STATE',
  );
});

test('API maps invalid JSON, validation failures, and unknown routes to JSON errors', async (t) => {
  const { baseUrl } = await startApi(t);
  const malformed = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokenFor('organizer-1')}`,
    },
    body: '{',
  });
  await assertError(malformed, 400, 'BAD_JSON');

  await assertError(
    await request(baseUrl, '/api/events', {
      method: 'POST',
      userId: 'organizer-1',
      body: { title: '', city: 'Lagos', venue: 'Hall', date: '2026-12-05' },
    }),
    400,
    'VALIDATION',
  );
  await assertError(await request(baseUrl, '/api/not-a-route'), 404, 'NOT_FOUND');
});

test('event service persists publish and unpublish through the repository', async () => {
  const repository = createMemoryRepository();
  let saveEventCount = 0;
  const saveEvent = repository.saveEvent;
  repository.saveEvent = async (event) => {
    saveEventCount += 1;
    return saveEvent(event);
  };
  const eventService = createEventService(repository);
  const event = await eventService.create('organizer-1', {
    title: 'Persistence Test',
    city: 'Lagos',
    venue: 'Hall',
    date: '2026-12-05',
  });
  await eventService.addTier('organizer-1', event.id, {
    name: 'General',
    priceCents: 1000,
    capacity: 2,
  });

  await eventService.publish('organizer-1', event.id);
  assert.equal((await repository.findEvent(event.id)).published, true);

  await eventService.unpublish('organizer-1', event.id);
  assert.equal((await repository.findEvent(event.id)).published, false);
  assert.equal(saveEventCount, 3);
});
