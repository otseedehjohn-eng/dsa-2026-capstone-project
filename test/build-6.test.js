import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBooking, getEvent, getHoldExpiry, listEvents, pay } from '../public/js/api.js';
import { mockBookings } from '../public/js/mockData.js';
import { formatPrice } from '../public/js/ui.js';
import { createApp } from '../src/http/app.js';

test('mock event browsing searches, filters by city and price, and sorts', async () => {
  const searchResults = await listEvents({ q: 'JAZZ', city: 'abuja' });
  assert.deepEqual(searchResults.map(({ id }) => id), ['abuja-jazz-night']);

  const affordable = await listEvents({ maxPriceCents: 100000, sort: 'price' });
  assert.deepEqual(affordable.map(({ id }) => id), ['lagos-food-festival']);

  const publishedEvents = await listEvents();
  assert.equal(publishedEvents.some(({ id }) => id === 'draft-event'), false);
  assert.deepEqual((await getEvent('lagos-tech-meetup')).tiers.map(({ id }) => id), [
    'lagos-tech-general',
    'lagos-tech-vip',
  ]);
});

test('mock checkout keeps declined bookings pending and allows retry', async () => {
  const event = await getEvent('abuja-jazz-night');
  const booking = await createBooking({
    eventId: event.id,
    tierId: 'abuja-jazz-front-row',
    attendeeName: 'Ada',
    quantity: 2,
  });
  assert.equal(booking.status, 'pending');
  assert.equal(booking.totalCents, 800000);
  assert.equal(Object.hasOwn(booking, 'holdExpiresAt'), false);
  assert.ok(Date.parse(await getHoldExpiry(booking.reference)) > Date.now());

  await assert.rejects(
    pay(booking.reference, { decline: true }),
    (error) => error.error.code === 'PAYMENT_DECLINED',
  );
  assert.equal(mockBookings.find(({ reference }) => reference === booking.reference).status, 'pending');

  const paid = await pay(booking.reference);
  assert.equal(paid.status, 'paid');
});

test('mock bookings enforce quantity limits and sold-out tiers', async () => {
  await assert.rejects(
    createBooking({
      eventId: 'lagos-tech-meetup',
      tierId: 'lagos-tech-general',
      attendeeName: 'Ada',
      quantity: 11,
    }),
    (error) => error.error.code === 'VALIDATION',
  );
  await assert.rejects(
    createBooking({
      eventId: 'lagos-tech-meetup',
      tierId: 'lagos-tech-vip',
      attendeeName: 'Ada',
      quantity: 1,
    }),
    (error) => error.error.code === 'SOLD_OUT',
  );
});

test('mock hold expiry releases the reserved seats', async () => {
  const eventId = 'lagos-tech-meetup';
  const tierId = 'lagos-tech-general';
  const before = (await getEvent(eventId)).tiers.find(({ id }) => id === tierId).seatsLeft;
  const booking = await createBooking({
    eventId,
    tierId,
    attendeeName: 'Ada',
    quantity: 1,
  });
  mockBookings.find(({ reference }) => reference === booking.reference).holdExpiresAt = new Date(0).toISOString();

  const afterExpiry = await getEvent(eventId);
  assert.equal(afterExpiry.tiers.find(({ id }) => id === tierId).seatsLeft, before);
  assert.equal(mockBookings.find(({ reference }) => reference === booking.reference).status, 'cancelled');
});

test('naira formatting converts whole cents to readable currency', () => {
  assert.equal(formatPrice(250000), '₦2,500');
});

test('static server serves the browser pages, modules, and stylesheet', async (context) => {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const [pathname, contentType] of [
    ['/', /text\/html/],
    ['/event.html', /text\/html/],
    ['/js/api.js', /javascript/],
    ['/js/pages/home.js', /javascript/],
    ['/css/styles.css', /text\/css/],
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type'), contentType);
  }
});
