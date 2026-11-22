import { DomainError } from '../domain/errors.js';
import { assertTransition } from '../domain/bookingStateMachine.js';
import { systemClock } from '../lib/clock.js';
import { signTicketToken, verifyTicketToken } from '../lib/ticketToken.js';

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('UNAUTHENTICATED', 'A valid user id is required.');
  }
  return userId.trim();
}

function requireEventId(eventId) {
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    throw new DomainError('VALIDATION', 'An event id is required for check-in.');
  }
  return eventId.trim();
}

function nowDate(clock) {
  const value = clock.now();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Clock must return a valid date.');
  }
  return date;
}

function rejectWrongEvent() {
  throw new DomainError('WRONG_EVENT', 'This ticket is for a different event.');
}

function rejectInactiveBooking() {
  throw new DomainError('BOOKING_NOT_ACTIVE', 'This ticket is not valid for check-in.');
}

function rejectDuplicate(checkedInAt) {
  throw new DomainError(
    'DUPLICATE_SCAN',
    `This ticket was already checked in at ${checkedInAt}.`,
  );
}

export function createCheckinService(repository, secret = process.env.TICKET_TOKEN_SECRET, {
  clock = systemClock,
} = {}) {
  return {
    async ticketForAttendee(userId, reference) {
      const attendeeId = requireUserId(userId);
      const booking = await repository.findBooking(reference);
      if (!booking || booking.userId !== attendeeId) {
        throw new DomainError('NOT_FOUND', `Booking "${reference}" was not found.`);
      }
      if (!['paid', 'checked_in'].includes(booking.status)) {
        throw new DomainError('INVALID_TRANSITION', 'Only paid bookings have a check-in ticket.');
      }
      const issuedAt = Math.floor(nowDate(clock).getTime() / 1000);
      return {
        ticketToken: signTicketToken(booking.reference, secret, issuedAt),
      };
    },

    async checkIn({ ticketToken, eventId } = {}) {
      const expectedEventId = requireEventId(eventId);
      const { reference } = verifyTicketToken(ticketToken, secret);
      assertTransition('paid', 'checked_in');
      const checkedInAt = nowDate(clock).toISOString();
      if (await repository.checkInBooking(reference, expectedEventId, checkedInAt)) {
        return { admitted: true, reference, checkedInAt };
      }

      const current = await repository.findBooking(reference);
      if (!current) {
        throw new DomainError('INVALID', 'This ticket code is invalid.');
      }
      if (current.eventId !== expectedEventId) rejectWrongEvent();
      if (current.status === 'checked_in') rejectDuplicate(current.checkedInAt);
      rejectInactiveBooking();
    },
  };
}
