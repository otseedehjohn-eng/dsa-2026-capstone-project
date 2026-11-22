import { DomainError } from '../domain/errors.js';
import { requireRole, requireUser } from './guards.js';
import { createRateLimiter } from '../lib/rateLimit.js';

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

export function registerApiRoutes(
  router,
  eventService,
  bookingService,
  tokenSecret = process.env.JWT_SECRET,
  waitlistService,
  checkinService,
  checkinRateLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 }),
) {
  router.add('POST', '/api/events', async ({ request, response, body }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'organizer');
    const event = await eventService.create(user.sub, requireBody(body));
    response.statusCode = 201;
    return event;
  });

  router.add('POST', '/api/events/:id/tiers', async ({ request, response, params, body }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'organizer');
    const tier = await eventService.addTier(
      user.sub,
      params.id,
      requireBody(body),
    );
    response.statusCode = 201;
    return tier;
  });

  router.add('POST', '/api/events/:id/publish', ({ request, params }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'organizer');
    return eventService.publish(user.sub, params.id);
  });

  router.add('POST', '/api/events/:id/unpublish', ({ request, params }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'organizer');
    return eventService.unpublish(user.sub, params.id);
  });

  router.add('GET', '/api/events/:id', ({ params }) => (
    eventService.getPublished(params.id)
  ));

  router.add('GET', '/api/organizer/events', ({ request }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'organizer');
    return eventService.listByOrganizer(user.sub);
  });

  router.add('GET', '/api/events', ({ query }) => {
    const { criteria, sortBy } = parseQuery(query);
    return eventService.search(criteria, sortBy);
  });

  router.add('POST', '/api/bookings', async ({ request, response, body }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'attendee');
    const booking = await bookingService.book(user.sub, requireBody(body));
    response.statusCode = 201;
    return booking;
  });

  router.add('GET', '/api/bookings', ({ request }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'attendee');
    return bookingService.list(user.sub);
  });

  router.add('GET', '/api/bookings/:reference', ({ request, params }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'attendee');
    return bookingService.get(user.sub, params.reference);
  });

  if (checkinService) {
    router.add('GET', '/api/bookings/:reference/ticket-token', ({ request, params }) => {
      const user = requireRole(requireUser(request, tokenSecret), 'attendee');
      return checkinService.ticketForAttendee(user.sub, params.reference);
    });

    router.add('POST', '/api/checkin', ({ request, body }) => {
      checkinRateLimiter.consume(request.socket?.remoteAddress ?? 'unknown');
      requireRole(requireUser(request, tokenSecret), 'staff');
      return checkinService.checkIn(requireBody(body));
    });
  }

  router.add('GET', '/api/bookings/:reference/refund', ({ request, params }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'attendee');
    return bookingService.previewCancellation(user.sub, params.reference);
  });

  router.add('POST', '/api/bookings/:reference/pay', ({ request, params, body }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'attendee');
    const paymentRequest = body === undefined ? {} : requireBody(body);
    if (paymentRequest.decline !== undefined && typeof paymentRequest.decline !== 'boolean') {
      throw new DomainError('VALIDATION', 'decline must be a boolean.');
    }
    return bookingService.pay(user.sub, params.reference, paymentRequest);
  });

  router.add('POST', '/api/bookings/:reference/cancel', ({ request, params }) => {
    const user = requireRole(requireUser(request, tokenSecret), 'attendee');
    return bookingService.cancel(user.sub, params.reference);
  });

  if (waitlistService) {
    router.add('POST', '/api/waitlist', ({ request, response, body }) => {
      const user = requireRole(requireUser(request, tokenSecret), 'attendee');
      response.statusCode = 201;
      return waitlistService.join(user.sub, requireBody(body));
    });

    router.add('GET', '/api/waitlist/offers', ({ request }) => {
      const user = requireRole(requireUser(request, tokenSecret), 'attendee');
      return waitlistService.listOffers(user.sub);
    });

    router.add('POST', '/api/waitlist/:offerId/accept', ({ request, params }) => {
      const user = requireRole(requireUser(request, tokenSecret), 'attendee');
      return waitlistService.accept(params.offerId, user.sub);
    });
  }
}
