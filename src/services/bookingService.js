import { DomainError } from '../domain/errors.js';
import { bookTickets as bookDomainTickets, createStore } from '../domain/inventory.js';
import { assertTransition } from '../domain/bookingStateMachine.js';
import { calculateRefund } from '../domain/refundPolicy.js';
import {
  BOOKING_HOLD_DURATION_MS,
  systemClock,
} from '../lib/clock.js';
import { createSeatService } from './seatService.js';

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('UNAUTHENTICATED', 'A valid user id is required.');
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

function readNow(clock) {
  const value = clock.now();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('Clock must return a valid date.');
  }
  return now;
}

function holdExpired(booking, now) {
  return typeof booking.holdExpiresAt === 'string'
    && Date.parse(booking.holdExpiresAt) <= now.getTime();
}

export function createBookingService(repository, paymentGateway, {
  clock = systemClock,
  seatService = createSeatService(repository),
  waitlistService,
  holdDurationMs = BOOKING_HOLD_DURATION_MS,
} = {}) {
  async function releaseSeats(eventId, tierId, quantity) {
    await seatService.release(eventId, tierId, quantity);
    if (waitlistService) await waitlistService.offerAvailable(eventId, tierId);
  }

  async function expirePending(reference, now = readNow(clock)) {
    const time = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(time.getTime())) {
      throw new TypeError('Expiry time must be a valid date.');
    }
    const booking = await repository.findBooking(reference);
    if (!booking || booking.status !== 'pending' || !holdExpired(booking, time)) return false;
    if (!await repository.compareAndSetBookingStatus(
      reference,
      'pending',
      'cancelled',
      { holdExpired: true },
    )) return false;
    await releaseSeats(booking.eventId, booking.tierId, booking.quantity);
    return true;
  }

  return {
    async list(userId) {
      const ownerId = requireUserId(userId);
      return (await repository.listBookings())
        .filter((booking) => booking.userId === ownerId);
    },

    async get(userId, reference) {
      const ownerId = requireUserId(userId);
      const booking = await repository.findBooking(reference);
      if (!booking || booking.userId !== ownerId) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      return booking;
    },

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
      if (!Number.isSafeInteger(holdDurationMs) || holdDurationMs < 1) {
        throw new TypeError('Booking hold duration must be a positive whole number of milliseconds.');
      }
      booking.userId = ownerId;
      booking.refundedCents = 0;
      booking.holdExpiresAt = new Date(readNow(clock).getTime() + holdDurationMs).toISOString();
      await seatService.reserve(eventId, tierId, quantity);
      try {
        return await repository.saveBooking(booking);
      } catch (error) {
        await seatService.release(eventId, tierId, quantity);
        throw error;
      }
    },

    async pay(userId, reference, { decline = false } = {}) {
      const ownerId = requireUserId(userId);
      let booking = await repository.findBooking(reference);
      if (!booking) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      if (booking.userId !== ownerId) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      const now = readNow(clock);
      if (booking.status === 'pending' && holdExpired(booking, now)) {
        await expirePending(reference, now);
        throw new DomainError('BOOKING_EXPIRED', 'This booking hold has expired.');
      }
      if (booking.status === 'cancelled' && booking.holdExpired) {
        throw new DomainError('BOOKING_EXPIRED', 'This booking hold has expired.');
      }
      assertTransition(booking.status, 'paid');

      const result = await paymentGateway.charge({
        amountCents: booking.totalCents,
        decline,
      });
      if (!result.success) {
        throw new DomainError('PAYMENT_DECLINED', 'The mock payment was declined.');
      }

      const paidAt = readNow(clock);
      if (holdExpired(booking, paidAt)) {
        await expirePending(reference, paidAt);
        throw new DomainError('BOOKING_EXPIRED', 'This booking hold has expired.');
      }
      if (!await repository.compareAndSetBookingStatus(reference, 'pending', 'paid')) {
        booking = await repository.findBooking(reference);
        if (booking?.status === 'cancelled' && holdExpired(booking, paidAt)) {
          throw new DomainError('BOOKING_EXPIRED', 'This booking hold has expired.');
        }
        throw new DomainError('INVALID_TRANSITION', 'This booking is no longer pending.');
      }
      return { ...booking, status: 'paid' };
    },

    async previewCancellation(userId, reference) {
      const ownerId = requireUserId(userId);
      const booking = await repository.findBooking(reference);
      if (!booking || booking.userId !== ownerId) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      if (booking.status === 'pending') {
        return { reference, refundCents: 0 };
      }
      if (booking.status !== 'paid') {
        throw new DomainError('INVALID_TRANSITION', 'Only pending or paid bookings can be cancelled.');
      }
      const event = await repository.findEvent(booking.eventId);
      if (!event) throw new DomainError('NOT_FOUND', `Event "${booking.eventId}" was not found.`);
      return {
        reference,
        refundCents: calculateRefund({
          amountCents: booking.totalCents,
          startsAt: event.date,
          now: readNow(clock),
        }),
      };
    },

    async cancel(userId, reference) {
      const ownerId = requireUserId(userId);
      const booking = await repository.findBooking(reference);
      if (!booking) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      if (booking.userId !== ownerId) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      if (booking.status === 'pending') {
        assertTransition(booking.status, 'cancelled');
        if (!await repository.compareAndSetBookingStatus(reference, 'pending', 'cancelled')) {
          throw new DomainError('INVALID_TRANSITION', 'This booking is no longer pending.');
        }
        await releaseSeats(booking.eventId, booking.tierId, booking.quantity);
        return { ...booking, status: 'cancelled', refundedCents: 0 };
      }

      if (booking.status !== 'paid') {
        throw new DomainError('INVALID_TRANSITION', 'Only pending or paid bookings can be cancelled.');
      }
      const event = await repository.findEvent(booking.eventId);
      if (!event) throw new DomainError('NOT_FOUND', `Event "${booking.eventId}" was not found.`);
      const refundCents = calculateRefund({
        amountCents: booking.totalCents,
        startsAt: event.date,
        now: readNow(clock),
      });
      const nextStatus = refundCents > 0 ? 'refunded' : 'cancelled';
      assertTransition(booking.status, nextStatus);
      if (!await repository.compareAndSetBookingStatus(
        reference,
        'paid',
        nextStatus,
        { refundedCents: refundCents },
      )) {
        throw new DomainError('INVALID_TRANSITION', 'This booking is no longer paid.');
      }

      let refundResult;
      try {
        refundResult = await paymentGateway.refund({
          amountCents: refundCents,
          reference: booking.reference,
        });
      } catch (error) {
        await repository.compareAndSetBookingStatus(reference, nextStatus, 'paid', { refundedCents: 0 });
        throw error;
      }
      if (!refundResult?.success) {
        await repository.compareAndSetBookingStatus(reference, nextStatus, 'paid', { refundedCents: 0 });
        throw new DomainError('REFUND_FAILED', 'The mock refund could not be completed.');
      }

      await releaseSeats(booking.eventId, booking.tierId, booking.quantity);
      return { ...booking, status: nextStatus, refundedCents: refundCents };
    },

    expirePending,
  };
}
