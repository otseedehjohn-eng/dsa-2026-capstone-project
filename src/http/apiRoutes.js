import { DomainError } from '../domain/errors.js';

function requireUserId(request) {
  const userId = request.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('UNAUTHENTICATED', 'The x-user-id header is required.');
  }
  return userId.trim();
}

function requireBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError('VALIDATION', 'A JSON object body is required.');
  }
  return body;
}

function parseQuery(query) {
  const criteria = {};
  for (const key of ['q', 'city', 'from', 'to']) {
    const value = query.get(key);
    if (value !== null) criteria[key] = value;
  }

  const maxPriceCents = query.get('maxPriceCents');
  if (maxPriceCents !== null) {
    criteria.maxPriceCents = Number(maxPriceCents);
  }

  const onlyAvailable = query.get('onlyAvailable');
  if (onlyAvailable !== null) {
    if (onlyAvailable !== 'true' && onlyAvailable !== 'false') {
      throw new DomainError('VALIDATION', 'onlyAvailable must be "true" or "false".');
    }
    criteria.onlyAvailable = onlyAvailable === 'true';
  }

  return { criteria, sortBy: query.get('sort') ?? 'date' };
}

export function registerApiRoutes(router, eventService, bookingService) {
  router.add('POST', '/api/events', async ({ request, response, body }) => {
    const event = await eventService.create(requireUserId(request), requireBody(body));
    response.statusCode = 201;
    return event;
  });

  router.add('POST', '/api/events/:id/tiers', async ({ request, response, params, body }) => {
    const tier = await eventService.addTier(
      requireUserId(request),
      params.id,
      requireBody(body),
    );
    response.statusCode = 201;
    return tier;
  });

  router.add('POST', '/api/events/:id/publish', ({ request, params }) => (
    eventService.publish(requireUserId(request), params.id)
  ));

  router.add('POST', '/api/events/:id/unpublish', ({ request, params }) => (
    eventService.unpublish(requireUserId(request), params.id)
  ));

  router.add('GET', '/api/events', ({ query }) => {
    const { criteria, sortBy } = parseQuery(query);
    return eventService.search(criteria, sortBy);
  });

  router.add('POST', '/api/bookings', async ({ request, response, body }) => {
    const booking = await bookingService.book(requireUserId(request), requireBody(body));
    response.statusCode = 201;
    return booking;
  });

  router.add('POST', '/api/bookings/:reference/pay', ({ request, params, body }) => {
    const paymentRequest = body === undefined ? {} : requireBody(body);
    if (paymentRequest.decline !== undefined && typeof paymentRequest.decline !== 'boolean') {
      throw new DomainError('VALIDATION', 'decline must be a boolean.');
    }
    return bookingService.pay(requireUserId(request), params.reference, paymentRequest);
  });

  router.add('POST', '/api/bookings/:reference/cancel', ({ request, params }) => (
    bookingService.cancel(requireUserId(request), params.reference)
  ));
}
