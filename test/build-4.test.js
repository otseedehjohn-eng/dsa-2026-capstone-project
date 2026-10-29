import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/http/app.js';
import { registerApiRoutes } from '../src/http/apiRoutes.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createEventService } from '../src/services/eventService.js';

async function startApi(t) {
  const repository = createMemoryRepository();
  const paymentGateway = createMockPaymentGateway();
  let chargeCount = 0;
  const gateway = {
    async charge(request) {
      chargeCount += 1;
      assert.equal(Object.hasOwn(request, 'cardNumber'), false);
      return paymentGateway.charge(request);
    },
  };
  const eventService = createEventService(repository);
  const bookingService = createBookingService(repository, gateway);
  const server = createApp({
    configureRouter(router) {
      registerApiRoutes(router, eventService, bookingService);
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
  };
}

async function request(baseUrl, route, { method = 'GET', userId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
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
  const { baseUrl, getChargeCount } = await startApi(t);

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
      date: '2026-12-05T17:00:00Z',
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
    '/api/events?q=TECH&city=lagos&from=2026-12-05&to=2026-12-05&maxPriceCents=5000&onlyAvailable=true&sort=price',
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
    403,
    'FORBIDDEN',
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
  await assertError(
    await request(baseUrl, `/api/bookings/${booking.reference}/cancel`, {
      method: 'POST',
      userId: 'attendee-1',
    }),
    409,
    'INVALID_TRANSITION',
  );
  assert.equal(getChargeCount(), 2);

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
    headers: { 'content-type': 'application/json', 'x-user-id': 'organizer-1' },
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
