import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { assertTransition, BOOKING_STATES, canTransition } from '../src/domain/bookingStateMachine.js';
import { DomainError } from '../src/domain/errors.js';
import { createApp } from '../src/http/app.js';
import { createRouter } from '../src/http/router.js';

test('booking state machine permits every specified transition', () => {
  for (const [from, to] of [
    ['pending', 'paid'],
    ['pending', 'cancelled'],
    ['paid', 'checked_in'],
    ['paid', 'refunded'],
    ['paid', 'cancelled'],
  ]) {
    assert.equal(canTransition(from, to), true);
    assert.doesNotThrow(() => assertTransition(from, to));
  }
  assert.deepEqual(BOOKING_STATES, ['pending', 'paid', 'cancelled', 'refunded', 'checked_in']);
});

test('booking state machine rejects every unspecified transition', () => {
  const allowed = new Set([
    'pending->paid',
    'pending->cancelled',
    'paid->checked_in',
    'paid->refunded',
    'paid->cancelled',
  ]);
  for (const from of BOOKING_STATES) {
    for (const to of BOOKING_STATES) {
      if (allowed.has(`${from}->${to}`)) continue;
      assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
      assert.throws(
        () => assertTransition(from, to),
        (error) => error instanceof DomainError && error.code === 'INVALID_TRANSITION',
      );
    }
  }
  assert.equal(canTransition('unknown', 'paid'), false);
});

test('router matches methods, literal paths, and decoded path parameters', () => {
  const handler = () => 'matched';
  const router = createRouter().add('get', '/events/:eventId', handler);

  assert.deepEqual(router.match('GET', '/events/event%201'), {
    handler,
    params: { eventId: 'event 1' },
  });
  assert.equal(router.match('POST', '/events/event%201'), undefined);
  assert.equal(router.match('GET', '/events/event%201/tickets'), undefined);
});

test('router rejects malformed encoded path parameters', () => {
  const router = createRouter().add('GET', '/events/:eventId', () => {});
  assert.throws(
    () => router.match('GET', '/events/%E0%A4%A'),
    (error) => error instanceof DomainError && error.code === 'BAD_REQUEST',
  );
});

test('HTTP server responds to GET /health', async (context) => {
  const app = createApp();
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  }));

  const response = await fetch(`http://127.0.0.1:${app.address().port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('HTTP server returns consistent JSON errors and does not expose static files outside public', async (context) => {
  const app = createApp();
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  }));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;

  const missing = await fetch(`${baseUrl}/api/missing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: { code: 'NOT_FOUND', message: 'The requested API route was not found.' },
  });

  const badJson = await fetch(`${baseUrl}/api/missing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(badJson.status, 400);
  assert.deepEqual(await badJson.json(), {
    error: { code: 'BAD_JSON', message: 'Request body must contain valid JSON.' },
  });

  const traversal = await fetch(`${baseUrl}/..%2fpackage.json`);
  assert.equal(traversal.status, 404);
  assert.deepEqual(await traversal.json(), {
    error: { code: 'NOT_FOUND', message: 'The requested file was not found.' },
  });
});

test('HTTP server serves the public index file', async (context) => {
  const app = createApp();
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  }));

  const response = await fetch(`http://127.0.0.1:${app.address().port}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /Event Ticketing/);
});
