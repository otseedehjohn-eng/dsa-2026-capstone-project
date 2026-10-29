export function createMemoryRepository() {
  const events = new Map();
  const bookings = new Map();

  return {
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

    async saveBooking(booking) {
      bookings.set(booking.reference, booking);
      return booking;
    },

    async findBooking(reference) {
      return bookings.get(reference) ?? null;
    },

    async listBookings() {
      return [...bookings.values()];
    },
  };
}
