import { DomainError } from '../domain/errors.js';

export function createSeatService(repository) {
  return {
    async reserve(eventId, tierId, quantity) {
      if (!await repository.reserveTierSeats(eventId, tierId, quantity)) {
        throw new DomainError('SOLD_OUT', 'There are not enough seats left in this tier.');
      }
    },

    async release(eventId, tierId, quantity) {
      if (!await repository.releaseTierSeats(eventId, tierId, quantity)) {
        throw new DomainError('INVALID_STATE', 'The booking seats could not be released.');
      }
    },
  };
}
