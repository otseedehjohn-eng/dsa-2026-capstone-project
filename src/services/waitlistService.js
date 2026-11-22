import { DomainError } from '../domain/errors.js';
import { newId, newReference } from '../domain/ids.js';
import {
  BOOKING_HOLD_DURATION_MS,
  systemClock,
  WAITLIST_OFFER_DURATION_MS,
} from '../lib/clock.js';

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('UNAUTHENTICATED', 'A valid user id is required.');
  }
  return userId.trim();
}

function requireAttendeeName(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('VALIDATION', 'Attendee name must be a non-empty string.');
  }
  return value.trim();
}

function nowDate(clock) {
  const value = clock.now();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Clock must return a valid date.');
  }
  return date;
}

export function createWaitlistService(repository, {
  clock = systemClock,
  offerDurationMs = WAITLIST_OFFER_DURATION_MS,
  bookingHoldDurationMs = BOOKING_HOLD_DURATION_MS,
} = {}) {
  if (
    !Number.isSafeInteger(offerDurationMs)
    || offerDurationMs < 1
    || !Number.isSafeInteger(bookingHoldDurationMs)
    || bookingHoldDurationMs < 1
  ) {
    throw new TypeError('Waitlist and booking hold durations must be positive whole milliseconds.');
  }

  async function offerAvailable(eventId, tierId) {
    const offers = [];
    while (true) {
      const now = nowDate(clock);
      const offer = await repository.createNextWaitlistOffer(eventId, tierId, {
        id: newId(),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + offerDurationMs).toISOString(),
      });
      if (!offer) return offers;
      offers.push(offer);
    }
  }

  async function expireOffer(offerId, now = nowDate(clock)) {
    const expired = await repository.expireWaitlistOffer(offerId, now.toISOString());
    if (!expired) return false;
    await offerAvailable(expired.eventId, expired.tierId);
    return true;
  }

  async function processExpiredOffers(now = nowDate(clock)) {
    const expiredOffers = await repository.listExpiredWaitlistOffers(now.toISOString());
    let count = 0;
    for (const offer of expiredOffers) {
      if (await expireOffer(offer.id, now)) count += 1;
    }
    return count;
  }

  return {
    async join(userId, { eventId, tierId, attendeeName } = {}) {
      const attendeeId = requireUserId(userId);
      const event = await repository.findEvent(eventId);
      if (!event) throw new DomainError('NOT_FOUND', `Event "${eventId}" was not found.`);
      const tier = await repository.findTier(eventId, tierId);
      if (!tier) throw new DomainError('NOT_FOUND', `Ticket tier "${tierId}" was not found.`);
      if (tier.seatsLeft > 0) {
        throw new DomainError('NOT_SOLD_OUT', 'Join the waitlist only when the tier is sold out.');
      }
      const now = nowDate(clock);
      const entry = await repository.createWaitlistEntry({
        id: newId(),
        attendeeId,
        eventId,
        tierId,
        attendeeName: requireAttendeeName(attendeeName),
        createdAt: now.toISOString(),
      });
      return {
        id: entry.id,
        eventId: entry.eventId,
        tierId: entry.tierId,
        status: entry.status,
      };
    },

    offerAvailable,
    expireOffer,
    processExpiredOffers,

    async listOffers(userId) {
      const attendeeId = requireUserId(userId);
      await processExpiredOffers();
      const now = nowDate(clock).toISOString();
      const offers = await repository.listWaitlistOffersForAttendee(attendeeId, now);
      return Promise.all(offers.map(async (offer) => {
        const event = await repository.findEvent(offer.eventId);
        const tier = await repository.findTier(offer.eventId, offer.tierId);
        return {
          id: offer.id,
          eventId: offer.eventId,
          eventTitle: event?.title ?? 'Event',
          tierId: offer.tierId,
          tierName: tier?.name ?? 'Ticket tier',
          quantity: offer.quantity,
          expiresAt: offer.expiresAt,
        };
      }));
    },

    async accept(offerId, userId) {
      const attendeeId = requireUserId(userId);
      const offer = await repository.findWaitlistOffer(offerId);
      if (!offer || offer.attendeeId !== attendeeId) {
        throw new DomainError('NOT_FOUND', `Waitlist offer "${offerId}" was not found.`);
      }
      const now = nowDate(clock);
      if (offer.status === 'offered' && offer.expiresAt <= now.toISOString()) {
        await expireOffer(offerId, now);
        throw new DomainError('OFFER_EXPIRED', 'This waitlist offer has expired.');
      }
      if (offer.status === 'expired') {
        throw new DomainError('OFFER_EXPIRED', 'This waitlist offer has expired.');
      }
      if (offer.status !== 'offered') {
        throw new DomainError('INVALID_TRANSITION', 'This waitlist offer is no longer available.');
      }

      const event = await repository.findEvent(offer.eventId);
      const tier = await repository.findTier(offer.eventId, offer.tierId);
      if (!event || !tier) {
        throw new DomainError('NOT_FOUND', 'The offered event or ticket tier was not found.');
      }
      const booking = {
        id: newId(),
        reference: newReference(),
        userId: attendeeId,
        eventId: offer.eventId,
        tierId: offer.tierId,
        attendeeName: offer.attendeeName,
        quantity: offer.quantity,
        totalCents: tier.priceCents * offer.quantity,
        refundedCents: 0,
        holdExpiresAt: new Date(now.getTime() + bookingHoldDurationMs).toISOString(),
        status: 'pending',
      };
      const accepted = await repository.acceptWaitlistOffer(
        offerId,
        attendeeId,
        now.toISOString(),
        booking,
      );
      if (!accepted) {
        const current = await repository.findWaitlistOffer(offerId);
        if (current?.attendeeId !== attendeeId) {
          throw new DomainError('NOT_FOUND', `Waitlist offer "${offerId}" was not found.`);
        }
        if (current?.status === 'offered' && current.expiresAt <= now.toISOString()) {
          await expireOffer(offerId, now);
          throw new DomainError('OFFER_EXPIRED', 'This waitlist offer has expired.');
        }
        throw new DomainError('INVALID_TRANSITION', 'This waitlist offer is no longer available.');
      }
      return accepted;
    },
  };
}
