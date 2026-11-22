import { DomainError } from '../domain/errors.js';

export function createMemoryRepository() {
  const events = new Map();
  const bookings = new Map();
  const users = new Map();
  const userIdsByEmail = new Map();
  const waitlistEntries = new Map();
  const waitlistOffers = new Map();
  let nextWaitlistPosition = 1;

  return {
    async saveUser(user) {
      if (userIdsByEmail.has(user.email)) {
        const error = new Error('Email is already registered.');
        error.code = 'EMAIL_TAKEN';
        throw error;
      }
      const savedUser = { ...user };
      users.set(user.id, savedUser);
      userIdsByEmail.set(user.email, user.id);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      };
    },

    async findUserByEmail(email) {
      const userId = userIdsByEmail.get(email);
      const user = userId ? users.get(userId) : null;
      return user ? { ...user } : null;
    },

    async findUserById(id) {
      const user = users.get(id);
      return user ? {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      } : null;
    },

    async saveEvent(event) {
      events.set(event.id, event);
      return event;
    },

    async findEvent(id) {
      return events.get(id) ?? null;
    },

    async listEvents() {
      return [...events.values()];
    },

    async saveTier(eventId, tier) {
      const event = events.get(eventId);
      if (!event) return null;
      event.tiers.set(tier.id, tier);
      return tier;
    },

    async findTier(eventId, tierId) {
      return events.get(eventId)?.tiers.get(tierId) ?? null;
    },

    async reserveTierSeats(eventId, tierId, quantity) {
      const tier = events.get(eventId)?.tiers.get(tierId);
      if (!tier || tier.sold + quantity > tier.capacity) return false;
      tier.sold += quantity;
      tier.seatsLeft = tier.capacity - tier.sold;
      return true;
    },

    async releaseTierSeats(eventId, tierId, quantity) {
      const tier = events.get(eventId)?.tiers.get(tierId);
      if (!tier || tier.sold < quantity) return false;
      tier.sold -= quantity;
      tier.seatsLeft = tier.capacity - tier.sold;
      return true;
    },

    async saveBooking(booking) {
      bookings.set(booking.reference, booking);
      return booking;
    },

    async compareAndSetBookingStatus(reference, expectedStatus, nextStatus, updates = {}) {
      const booking = bookings.get(reference);
      if (!booking || booking.status !== expectedStatus) return false;
      booking.status = nextStatus;
      if (updates.refundedCents !== undefined) booking.refundedCents = updates.refundedCents;
      if (updates.holdExpiresAt !== undefined) booking.holdExpiresAt = updates.holdExpiresAt;
      if (updates.holdExpired !== undefined) booking.holdExpired = updates.holdExpired;
      return true;
    },

    async findBooking(reference) {
      return bookings.get(reference) ?? null;
    },

    async listBookings() {
      return [...bookings.values()];
    },

    async listExpiredPendingBookings(now) {
      return [...bookings.values()].filter((booking) => (
        booking.status === 'pending'
        && booking.holdExpiresAt !== null
        && booking.holdExpiresAt !== undefined
        && booking.holdExpiresAt <= now
      ));
    },

    async createWaitlistEntry(entry) {
      const existing = [...waitlistEntries.values()].some((candidate) => (
        candidate.attendeeId === entry.attendeeId
        && candidate.eventId === entry.eventId
        && candidate.tierId === entry.tierId
        && ['waiting', 'offered'].includes(candidate.status)
      ));
      if (existing) {
        throw new DomainError('ALREADY_ON_WAITLIST', 'You are already on this waitlist.');
      }
      const tier = events.get(entry.eventId)?.tiers.get(entry.tierId);
      if (!tier || tier.sold < tier.capacity) {
        throw new DomainError('NOT_SOLD_OUT', 'Join the waitlist only when the tier is sold out.');
      }
      const saved = { ...entry, position: nextWaitlistPosition++, status: 'waiting' };
      waitlistEntries.set(saved.id, saved);
      return { ...saved };
    },

    async createNextWaitlistOffer(eventId, tierId, offer) {
      const tier = events.get(eventId)?.tiers.get(tierId);
      if (!tier || tier.sold >= tier.capacity) return null;
      const entry = [...waitlistEntries.values()]
        .filter((candidate) => (
          candidate.eventId === eventId
          && candidate.tierId === tierId
          && candidate.status === 'waiting'
        ))
        .sort((left, right) => left.position - right.position)[0];
      if (!entry) return null;

      tier.sold += 1;
      tier.seatsLeft = tier.capacity - tier.sold;
      entry.status = 'offered';
      const saved = {
        ...offer,
        attendeeId: entry.attendeeId,
        attendeeName: entry.attendeeName,
        eventId,
        tierId,
        quantity: 1,
        waitlistEntryId: entry.id,
        status: 'offered',
        bookingReference: null,
      };
      waitlistOffers.set(saved.id, saved);
      return { ...saved };
    },

    async findWaitlistOffer(id) {
      const offer = waitlistOffers.get(id);
      return offer ? { ...offer } : null;
    },

    async listWaitlistOffersForAttendee(attendeeId, now) {
      return [...waitlistOffers.values()]
        .filter((offer) => offer.attendeeId === attendeeId
          && offer.status === 'offered'
          && offer.expiresAt > now)
        .map((offer) => ({ ...offer }));
    },

    async listExpiredWaitlistOffers(now) {
      return [...waitlistOffers.values()]
        .filter((offer) => offer.status === 'offered' && offer.expiresAt <= now)
        .map((offer) => ({ ...offer }));
    },

    async expireWaitlistOffer(id, now) {
      const offer = waitlistOffers.get(id);
      if (!offer || offer.status !== 'offered' || offer.expiresAt > now) return null;
      const tier = events.get(offer.eventId)?.tiers.get(offer.tierId);
      if (!tier || tier.sold < offer.quantity) {
        throw new DomainError('INVALID_STATE', 'The expired offer seats could not be released.');
      }
      tier.sold -= offer.quantity;
      tier.seatsLeft = tier.capacity - tier.sold;
      offer.status = 'expired';
      const entry = waitlistEntries.get(offer.waitlistEntryId);
      if (entry) entry.status = 'expired';
      return { ...offer };
    },

    async acceptWaitlistOffer(id, attendeeId, now, booking) {
      const offer = waitlistOffers.get(id);
      if (
        !offer
        || offer.attendeeId !== attendeeId
        || offer.status !== 'offered'
        || offer.expiresAt <= now
      ) {
        return null;
      }
      offer.status = 'accepted';
      offer.bookingReference = booking.reference;
      const entry = waitlistEntries.get(offer.waitlistEntryId);
      if (entry) entry.status = 'accepted';
      bookings.set(booking.reference, booking);
      return booking;
    },
  };
}
