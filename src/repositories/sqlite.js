import { DomainError } from '../domain/errors.js';
import { Queue } from '../domain/waitlistQueue.js';

function mapTier(row) {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    capacity: row.capacity,
    sold: row.sold,
    seatsLeft: row.capacity - row.sold,
    waitlist: new Queue(),
  };
}

function mapEvent(row, tiers) {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    title: row.title,
    city: row.city,
    venue: row.venue,
    date: row.date,
    published: row.published === 1,
    tiers: new Map(tiers.map((tier) => [tier.id, tier])),
  };
}

function mapBooking(row) {
  return {
    id: row.id,
    reference: row.reference,
    userId: row.attendee_id,
    eventId: row.event_id,
    tierId: row.tier_id,
    attendeeName: row.attendee_name,
    quantity: row.quantity,
    totalCents: row.total_cents,
    status: row.status,
  };
}

export function createSqliteRepository(database) {
  const findEventRow = database.prepare('SELECT * FROM events WHERE id = ?');
  const findTierRows = database.prepare('SELECT * FROM ticket_tiers WHERE event_id = ?');
  const findTierRow = database.prepare('SELECT * FROM ticket_tiers WHERE event_id = ? AND id = ?');
  const findBookingRow = database.prepare('SELECT * FROM bookings WHERE reference = ?');
  const eventRows = database.prepare('SELECT * FROM events');
  const bookingRows = database.prepare('SELECT * FROM bookings');
  const userByEmailRow = database.prepare('SELECT * FROM users WHERE email = ?');
  const userByIdRow = database.prepare('SELECT id, email, name, role FROM users WHERE id = ?');

  function ensureUser(id, role) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('A non-empty user id is required to save this record.');
    }
    database.prepare(`
      INSERT OR IGNORE INTO users (id, name, email, role)
      VALUES (?, ?, ?, ?)
    `).run(id, id, `${id}@ticketing.local`, role);
  }

  function loadEvent(row) {
    if (!row) return null;
    const tiers = findTierRows.all(row.id).map(mapTier);
    return mapEvent(row, tiers);
  }

  function saveTierRow(eventId, tier) {
    database.prepare(`
      INSERT INTO ticket_tiers (id, event_id, name, price_cents, capacity, sold)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        event_id = excluded.event_id,
        name = excluded.name,
        price_cents = excluded.price_cents,
        capacity = excluded.capacity,
        sold = excluded.sold
    `).run(tier.id, eventId, tier.name, tier.priceCents, tier.capacity, tier.sold);
  }

  return {
    async saveUser(user) {
      try {
        database.prepare(`
          INSERT INTO users (id, name, email, role, password_hash)
          VALUES (?, ?, ?, ?, ?)
        `).run(user.id, user.name, user.email, user.role, user.passwordHash);
      } catch (error) {
        if (error.message.includes('UNIQUE constraint failed: users.email')) {
          throw new DomainError('EMAIL_TAKEN', 'That email is already registered.');
        }
        throw error;
      }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      };
    },

    async findUserByEmail(email) {
      const row = userByEmailRow.get(email);
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        passwordHash: row.password_hash,
      };
    },

    async findUserById(id) {
      const row = userByIdRow.get(id);
      return row ?? null;
    },

    async saveEvent(event) {
      ensureUser(event.organizerId, 'organizer');
      database.prepare(`
        INSERT INTO events (id, organizer_id, title, city, venue, date, published)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          organizer_id = excluded.organizer_id,
          title = excluded.title,
          city = excluded.city,
          venue = excluded.venue,
          date = excluded.date,
          published = excluded.published
      `).run(
        event.id,
        event.organizerId,
        event.title,
        event.city,
        event.venue,
        event.date,
        event.published ? 1 : 0,
      );
      return event;
    },

    async findEvent(id) {
      return loadEvent(findEventRow.get(id));
    },

    async listEvents() {
      return eventRows.all().map(loadEvent);
    },

    async saveTier(eventId, tier) {
      if (!findEventRow.get(eventId)) return null;
      saveTierRow(eventId, tier);
      return tier;
    },

    async findTier(eventId, tierId) {
      const row = findTierRow.get(eventId, tierId);
      return row ? mapTier(row) : null;
    },

    async reserveTierSeats(eventId, tierId, quantity) {
      const result = database.prepare(`
        UPDATE ticket_tiers
        SET sold = sold + ?
        WHERE event_id = ? AND id = ? AND sold + ? <= capacity
      `).run(quantity, eventId, tierId, quantity);
      return result.changes === 1;
    },

    async releaseTierSeats(eventId, tierId, quantity) {
      const result = database.prepare(`
        UPDATE ticket_tiers
        SET sold = sold - ?
        WHERE event_id = ? AND id = ? AND sold >= ?
      `).run(quantity, eventId, tierId, quantity);
      return result.changes === 1;
    },

    async saveBooking(booking) {
      ensureUser(booking.userId, 'attendee');
      database.prepare(`
        INSERT INTO bookings (
          id, reference, attendee_id, event_id, tier_id, attendee_name,
          quantity, total_cents, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(reference) DO UPDATE SET
          attendee_id = excluded.attendee_id,
          event_id = excluded.event_id,
          tier_id = excluded.tier_id,
          attendee_name = excluded.attendee_name,
          quantity = excluded.quantity,
          total_cents = excluded.total_cents,
          status = excluded.status
      `).run(
        booking.id,
        booking.reference,
        booking.userId,
        booking.eventId,
        booking.tierId,
        booking.attendeeName,
        booking.quantity,
        booking.totalCents,
        booking.status,
      );
      return booking;
    },

    async findBooking(reference) {
      const row = findBookingRow.get(reference);
      return row ? mapBooking(row) : null;
    },

    async listBookings() {
      return bookingRows.all().map(mapBooking);
    },
  };
}
