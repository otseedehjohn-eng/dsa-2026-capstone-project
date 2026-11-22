import { systemClock } from '../lib/clock.js';

export function createMaintenance({ repository, bookingService, waitlistService, clock = systemClock }) {
  return {
    async run() {
      const now = clock.now();
      const expiredBookings = await repository.listExpiredPendingBookings(now.toISOString());
      let bookingsCancelled = 0;
      for (const booking of expiredBookings) {
        if (await bookingService.expirePending(booking.reference, now)) {
          bookingsCancelled += 1;
        }
      }

      const offersExpired = await waitlistService.processExpiredOffers(now);
      return { bookingsCancelled, offersExpired };
    },
  };
}
