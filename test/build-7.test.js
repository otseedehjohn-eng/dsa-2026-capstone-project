import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/http/app.js';
import { registerApiRoutes } from '../src/http/apiRoutes.js';
import { requireRole } from '../src/http/guards.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { DomainError } from '../src/domain/errors.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { signToken } from '../src/lib/token.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createAuthService } from '../src/services/authService.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createEventService } from '../src/services/eventService.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createDatabase } from '../src/db/connection.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import {
  createBooking as browserCreateBooking,
  getMe as browserGetMe,
  listEvents as browserListEvents,
  listMyBookings as browserListMyBookings,
  signUp as browserSignUp,
} from '../public/js/api.js';
import { saveSession } from '../public/js/session.js';

const TOKEN_SECRET = 'build-seven-tests-use-a-long-secret-32-bytes';

async function startApi(context) {
  const repository = createMemoryRepository();
  const authService = createAuthService(repository, TOKEN_SECRET);
  const eventService = createEventService(repository);
  const bookingService = createBookingService(repository, createMockPaymentGateway());
  const server = createApp({
    configureRouter(router) {
      registerAuthRoutes(router, authService, TOKEN_SECRET);
      registerApiRoutes(router, eventService, bookingService, TOKEN_SECRET);
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repository,
  };
}

async function request(baseUrl, pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signUp(baseUrl, email, role = 'attendee') {
  const response = await request(baseUrl, '/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'secure-password-7', role },
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function assertApiError(response, status, code) {
  assert.equal(response.status, status);
  const result = await response.json();
  assert.equal(result.error.code, code);
  return result.error.message;
}

test('scrypt uses a random salt and verifies only the matching password', async () => {
  const firstHash = await hashPassword('correct-horse');
  const secondHash = await hashPassword('correct-horse');
  assert.notEqual(firstHash, secondHash);
  assert.equal(firstHash.includes('correct-horse'), false);
  assert.equal(await verifyPassword('correct-horse', firstHash), true);
  assert.equal(await verifyPassword('wrong-password', firstHash), false);
});

test('signup stores only a hash, rejects duplicate emails, and login errors are indistinguishable', async (context) => {
  const { baseUrl, repository } = await startApi(context);
  const signupResponse = await request(baseUrl, '/api/auth/signup', {
    method: 'POST',
    body: { email: 'Ada@Example.com', password: 'secure-password-7', role: 'attendee' },
  });
  assert.equal(signupResponse.status, 201);
  const session = await signupResponse.json();
  assert.equal(session.user.email, 'ada@example.com');
  assert.equal(typeof session.token, 'string');
  assert.equal(JSON.stringify(session).includes('secure-password-7'), false);

  const storedUser = await repository.findUserByEmail('ada@example.com');
  assert.notEqual(storedUser.passwordHash, 'secure-password-7');
  assert.equal(await verifyPassword('secure-password-7', storedUser.passwordHash), true);

  await assertApiError(
    await request(baseUrl, '/api/auth/signup', {
      method: 'POST',
      body: { email: 'ada@example.com', password: 'secure-password-7', role: 'attendee' },
    }),
    409,
    'EMAIL_TAKEN',
  );
  await assertApiError(
    await request(baseUrl, '/api/auth/signup', {
      method: 'POST',
      body: { email: 'short@example.com', password: 'short', role: 'attendee' },
    }),
    400,
    'VALIDATION',
  );

  const loginResponse = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { email: 'ADA@example.com', password: 'secure-password-7' },
  });
  assert.equal(loginResponse.status, 200);
  assert.equal((await loginResponse.json()).user.id, session.user.id);

  const wrongMessage = await assertApiError(
    await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'ada@example.com', password: 'incorrect-password' },
    }),
    401,
    'INVALID_CREDENTIALS',
  );
  const unknownMessage = await assertApiError(
    await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'unknown@example.com', password: 'incorrect-password' },
    }),
    401,
    'INVALID_CREDENTIALS',
  );
  assert.equal(wrongMessage, unknownMessage);

  const meResponse = await request(baseUrl, '/api/auth/me', { token: session.token });
  const me = await meResponse.json();
  assert.equal(me.user.email, 'ada@example.com');
  assert.equal(Object.hasOwn(me.user, 'passwordHash'), false);
});

test('missing, malformed, tampered, non-HS256, and expired tokens are rejected', async (context) => {
  const { baseUrl } = await startApi(context);
  const user = await signUp(baseUrl, 'token-user@example.com');
  const expiredToken = signToken({
    sub: user.user.id,
    email: user.user.email,
    role: user.user.role,
  }, TOKEN_SECRET, { nowSeconds: 1 });
  const [header, payload, signature] = user.token.split('.');
  const nonHsHeader = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
  const nonHsToken = `${nonHsHeader}.${payload}.${signature}`;
  const editedSignature = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
  const tamperedToken = `${header}.${payload}.${editedSignature}`;

  for (const token of [undefined, 'not-a-token', expiredToken, nonHsToken, tamperedToken]) {
    await assertApiError(
      await request(baseUrl, '/api/auth/me', { token }),
      401,
      'UNAUTHENTICATED',
    );
  }
});

test('wrong roles are rejected and booking access is private to the attendee', async (context) => {
  const { baseUrl } = await startApi(context);
  const organizer = await signUp(baseUrl, 'organizer@example.com', 'organizer');
  const otherOrganizer = await signUp(baseUrl, 'other-organizer@example.com', 'organizer');
  const attendee = await signUp(baseUrl, 'attendee@example.com');
  const otherAttendee = await signUp(baseUrl, 'other-attendee@example.com');

  await assertApiError(
    await request(baseUrl, '/api/events', {
      method: 'POST',
      token: attendee.token,
      body: { title: 'No', city: 'Lagos', venue: 'Hall', date: '2027-01-15' },
    }),
    403,
    'FORBIDDEN',
  );

  const created = await request(baseUrl, '/api/events', {
    method: 'POST',
    token: organizer.token,
    body: {
      title: 'Private Booking Test',
      city: 'Lagos',
      venue: 'Hall',
      date: '2027-01-15',
    },
  });
  const event = await created.json();
  const tierResponse = await request(baseUrl, `/api/events/${event.id}/tiers`, {
    method: 'POST',
    token: organizer.token,
    body: { name: 'General', priceCents: 5000, capacity: 2 },
  });
  const tier = await tierResponse.json();
  await request(baseUrl, `/api/events/${event.id}/publish`, {
    method: 'POST',
    token: organizer.token,
  });

  await assertApiError(
    await request(baseUrl, `/api/events/${event.id}/tiers`, {
      method: 'POST',
      token: otherOrganizer.token,
      body: { name: 'Other', priceCents: 1000, capacity: 1 },
    }),
    403,
    'FORBIDDEN',
  );

  const bookingResponse = await request(baseUrl, '/api/bookings', {
    method: 'POST',
    token: attendee.token,
    body: {
      eventId: event.id,
      tierId: tier.id,
      attendeeName: 'Ada',
      quantity: 1,
    },
  });
  const booking = await bookingResponse.json();

  assert.equal((await (await request(baseUrl, '/api/bookings', {
    token: attendee.token,
  })).json()).length, 1);
  assert.equal((await (await request(baseUrl, '/api/bookings', {
    token: otherAttendee.token,
  })).json()).length, 0);

  await assertApiError(
    await request(baseUrl, `/api/bookings/${booking.reference}`, { token: otherAttendee.token }),
    404,
    'NOT_FOUND',
  );
  await assertApiError(
    await request(baseUrl, `/api/bookings/${booking.reference}/cancel`, {
      method: 'POST',
      token: otherAttendee.token,
    }),
    404,
    'NOT_FOUND',
  );
  assert.equal((await (await request(baseUrl, `/api/bookings/${booking.reference}`, {
    token: attendee.token,
  })).json()).reference, booking.reference);
});

test('token and role guards surface consistent domain errors', async () => {
  assert.throws(
    () => {
      requireRole({ sub: 'staff-1', role: 'staff' }, 'attendee');
    },
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
});

test('SQLite-backed authentication creates persistent hashed credentials', async () => {
  const database = createDatabase(':memory:');
  try {
    const repository = createSqliteRepository(database);
    const authService = createAuthService(repository, TOKEN_SECRET);
    const created = await authService.signup({
      email: 'sqlite-user@example.com',
      password: 'secure-password-7',
      role: 'attendee',
    });
    const stored = await repository.findUserByEmail('sqlite-user@example.com');
    assert.equal(stored.passwordHash.includes('secure-password-7'), false);
    assert.equal((await authService.login({
      email: 'sqlite-user@example.com',
      password: 'secure-password-7',
    })).user.id, created.user.id);
  } finally {
    database.close();
  }
});

test('browser API sends the saved bearer token to protected routes', async (context) => {
  const { baseUrl } = await startApi(context);
  const storage = new Map();
  const fakeSessionStorage = {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  const previousFetch = globalThis.fetch;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  let protectedAuthorization;

  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: fakeSessionStorage,
  });
  globalThis.fetch = (input, options) => {
    const url = new URL(input, baseUrl);
    if (url.pathname === '/api/bookings') {
      protectedAuthorization = options.headers.authorization;
    }
    return previousFetch(url, options);
  };

  try {
    const session = await browserSignUp({
      email: 'browser-attendee@example.com',
      password: 'secure-password-7',
      role: 'attendee',
    });
    saveSession(session);
    assert.equal((await browserGetMe()).user.id, session.user.id);
    assert.deepEqual(await browserListEvents(), []);
    assert.deepEqual(await browserListMyBookings(), []);
    assert.equal(protectedAuthorization, `Bearer ${session.token}`);
    await assert.rejects(
      browserCreateBooking({
        eventId: 'missing',
        tierId: 'missing',
        attendeeName: 'Ada',
        quantity: 1,
      }),
      (error) => error.error.code === 'NOT_FOUND',
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage) {
      Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    } else {
      delete globalThis.sessionStorage;
    }
  }
});
