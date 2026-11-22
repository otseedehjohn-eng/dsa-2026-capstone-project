export function createMemoryRepository() {
  const events = new Map();
  const bookings = new Map();
  const users = new Map();
  const userIdsByEmail = new Map();

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

    async findBooking(reference) {
      return bookings.get(reference) ?? null;
    },

    async listBookings() {
      return [...bookings.values()];
    },
  };
}
