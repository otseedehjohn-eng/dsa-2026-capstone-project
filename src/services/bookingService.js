import { DomainError } from '../domain/errors.js';
import {
  bookTickets as bookDomainTickets,
  cancelBooking as cancelDomainBooking,
  createStore,
} from '../domain/inventory.js';
import { assertTransition } from '../domain/bookingStateMachine.js';

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('UNAUTHENTICATED', 'The x-user-id header is required.');
  }
  return userId.trim();
}

function storeFor(event, bookings = [], detachEvent = false) {
  const store = createStore();
  const storedEvent = detachEvent
    ? {
      ...event,
      tiers: new Map([...event.tiers].map(([id, tier]) => [id, { ...tier }])),
    }
    : event;
  store.events.set(storedEvent.id, storedEvent);
  for (const booking of bookings) store.bookingsByReference.set(booking.reference, booking);
  return store;
}

export function createBookingService(repository, paymentGateway) {
  return {
    async book(userId, { eventId, tierId, attendeeName, quantity }) {
      const ownerId = requireUserId(userId);
      const event = await repository.findEvent(eventId);
      if (!event) {
        throw new DomainError('NOT_FOUND', `Event "${eventId}" was not found.`);
      }
      if (!event.published) {
        throw new DomainError('INVALID_STATE', 'Tickets can only be booked for a published event.');
      }
      if (!await repository.findTier(eventId, tierId)) {
        throw new DomainError('NOT_FOUND', `Ticket tier "${tierId}" was not found.`);
      }

      const store = storeFor(event, await repository.listBookings(), true);
      const booking = bookDomainTickets(store, eventId, tierId, attendeeName, quantity);
      if (!await repository.reserveTierSeats(eventId, tierId, quantity)) {
        throw new DomainError('SOLD_OUT', 'There are not enough seats left in this tier.');
      }
      booking.userId = ownerId;
      return repository.saveBooking(booking);
    },

    async pay(userId, reference, { decline = false } = {}) {
      const ownerId = requireUserId(userId);
      const booking = await repository.findBooking(reference);
      if (!booking) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      if (booking.userId !== ownerId) {
        throw new DomainError('FORBIDDEN', 'Only the attendee who made this booking can pay for it.');
      }
      assertTransition(booking.status, 'paid');

      const result = await paymentGateway.charge({
        amountCents: booking.totalCents,
        decline,
      });
      if (!result.success) {
        throw new DomainError('PAYMENT_DECLINED', 'The mock payment was declined.');
      }

      booking.status = 'paid';
      await repository.saveBooking(booking);
      return booking;
    },

    async cancel(userId, reference) {
      const ownerId = requireUserId(userId);
      const booking = await repository.findBooking(reference);
      if (!booking) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      if (booking.userId !== ownerId) {
        throw new DomainError('FORBIDDEN', 'Only the attendee who made this booking can cancel it.');
      }
      if (booking.status !== 'pending') {
        throw new DomainError('INVALID_TRANSITION', 'Only pending bookings can be cancelled in this build.');
      }
      assertTransition(booking.status, 'cancelled');

      const event = await repository.findEvent(booking.eventId);
      if (!event) {
        throw new DomainError('NOT_FOUND', `Event "${booking.eventId}" was not found.`);
      }
      const cancelledBooking = cancelDomainBooking(
        storeFor(event, await repository.listBookings(), true),
        reference,
      );
      if (!await repository.releaseTierSeats(booking.eventId, booking.tierId, booking.quantity)) {
        throw new DomainError('INVALID_STATE', 'The booking seats could not be released.');
      }
      await repository.saveBooking(cancelledBooking);
      return cancelledBooking;
    },
  };
}
