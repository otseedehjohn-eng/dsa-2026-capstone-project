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
    refundedCents: row.refunded_cents,
    holdExpiresAt: row.hold_expires_at,
    holdExpired: row.hold_expired === 1,
    status: row.status,
  };
}

function mapWaitlistOffer(row) {
  return {
    id: row.id,
    waitlistEntryId: row.waitlist_entry_id,
    attendeeId: row.attendee_id,
    eventId: row.event_id,
    tierId: row.tier_id,
    quantity: row.quantity,
    attendeeName: row.attendee_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    bookingReference: row.booking_reference,
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
  const insertBookingRow = database.prepare(`
    INSERT INTO bookings (
      id, reference, attendee_id, event_id, tier_id, attendee_name,
      quantity, total_cents, refunded_cents, hold_expires_at, hold_expired, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reference) DO UPDATE SET
      attendee_id = excluded.attendee_id,
      event_id = excluded.event_id,
      tier_id = excluded.tier_id,
      attendee_name = excluded.attendee_name,
      quantity = excluded.quantity,
      total_cents = excluded.total_cents,
      refunded_cents = excluded.refunded_cents,
      hold_expires_at = excluded.hold_expires_at,
      hold_expired = excluded.hold_expired,
      status = excluded.status
  `);

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
      insertBookingRow.run(
        booking.id,
        booking.reference,
        booking.userId,
        booking.eventId,
        booking.tierId,
        booking.attendeeName,
        booking.quantity,
        booking.totalCents,
        booking.refundedCents ?? 0,
        booking.holdExpiresAt ?? null,
        booking.holdExpired ? 1 : 0,
        booking.status,
      );
      return booking;
    },

    async compareAndSetBookingStatus(reference, expectedStatus, nextStatus, updates = {}) {
      const refundedCents = updates.refundedCents ?? null;
      const holdExpiresAt = updates.holdExpiresAt ?? null;
      const holdExpired = updates.holdExpired === undefined ? null : Number(updates.holdExpired);
      const result = database.prepare(`
        UPDATE bookings
        SET status = ?,
            refunded_cents = COALESCE(?, refunded_cents),
            hold_expires_at = COALESCE(?, hold_expires_at),
            hold_expired = COALESCE(?, hold_expired)
        WHERE reference = ? AND status = ?
      `).run(
        nextStatus,
        refundedCents,
        holdExpiresAt,
        holdExpired,
        reference,
        expectedStatus,
      );
      return result.changes === 1;
    },

    async findBooking(reference) {
      const row = findBookingRow.get(reference);
      return row ? mapBooking(row) : null;
    },

    async listBookings() {
      return bookingRows.all().map(mapBooking);
    },

    async listExpiredPendingBookings(now) {
      return database.prepare(`
        SELECT * FROM bookings
        WHERE status = 'pending'
          AND hold_expires_at IS NOT NULL
          AND hold_expires_at <= ?
        ORDER BY hold_expires_at, reference
      `).all(now).map(mapBooking);
    },

    async createWaitlistEntry(entry) {
      const existing = database.prepare(`
        SELECT id FROM waitlist_entries
        WHERE attendee_id = ? AND event_id = ? AND tier_id = ?
          AND status IN ('waiting', 'offered')
        LIMIT 1
      `).get(entry.attendeeId, entry.eventId, entry.tierId);
      if (existing) {
        throw new DomainError('ALREADY_ON_WAITLIST', 'You are already on this waitlist.');
      }

      try {
        const result = database.prepare(`
          INSERT INTO waitlist_entries (
            id, attendee_id, event_id, tier_id, attendee_name, created_at, status
          )
          SELECT ?, ?, ?, ?, ?, ?, 'waiting'
          FROM ticket_tiers
          WHERE event_id = ? AND id = ? AND sold >= capacity
        `).run(
          entry.id,
          entry.attendeeId,
          entry.eventId,
          entry.tierId,
          entry.attendeeName,
          entry.createdAt,
          entry.eventId,
          entry.tierId,
        );
        if (result.changes !== 1) {
          throw new DomainError('NOT_SOLD_OUT', 'Join the waitlist only when the tier is sold out.');
        }
      } catch (error) {
        if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') {
          throw new DomainError('ALREADY_ON_WAITLIST', 'You are already on this waitlist.');
        }
        throw error;
      }
      return { ...entry, status: 'waiting' };
    },

    async createNextWaitlistOffer(eventId, tierId, offer) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const entryRow = database.prepare(`
          SELECT * FROM waitlist_entries
          WHERE event_id = ? AND tier_id = ? AND status = 'waiting'
          ORDER BY position
          LIMIT 1
        `).get(eventId, tierId);
        if (!entryRow) {
          database.exec('COMMIT');
          return null;
        }
        const reservation = database.prepare(`
          UPDATE ticket_tiers
          SET sold = sold + 1
          WHERE event_id = ? AND id = ? AND sold < capacity
        `).run(eventId, tierId);
        if (reservation.changes !== 1) {
          database.exec('COMMIT');
          return null;
        }
        const entryUpdate = database.prepare(`
          UPDATE waitlist_entries SET status = 'offered'
          WHERE id = ? AND status = 'waiting'
        `).run(entryRow.id);
        if (entryUpdate.changes !== 1) {
          database.prepare(`
            UPDATE ticket_tiers SET sold = sold - 1
            WHERE event_id = ? AND id = ? AND sold >= 1
          `).run(eventId, tierId);
          database.exec('COMMIT');
          return null;
        }
        database.prepare(`
          INSERT INTO waitlist_offers (
            id, waitlist_entry_id, attendee_id, event_id, tier_id, quantity,
            created_at, expires_at, status
          )
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'offered')
        `).run(
          offer.id,
          entryRow.id,
          entryRow.attendee_id,
          eventId,
          tierId,
          offer.createdAt,
          offer.expiresAt,
        );
        database.exec('COMMIT');
        return mapWaitlistOffer({
          id: offer.id,
          waitlist_entry_id: entryRow.id,
          attendee_id: entryRow.attendee_id,
          attendee_name: entryRow.attendee_name,
          event_id: eventId,
          tier_id: tierId,
          quantity: 1,
          created_at: offer.createdAt,
          expires_at: offer.expiresAt,
          status: 'offered',
          booking_reference: null,
        });
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    async findWaitlistOffer(id) {
      const row = database.prepare(`
        SELECT offers.*, entries.attendee_name
        FROM waitlist_offers AS offers
        JOIN waitlist_entries AS entries ON entries.id = offers.waitlist_entry_id
        WHERE offers.id = ?
      `).get(id);
      return row ? mapWaitlistOffer(row) : null;
    },

    async listWaitlistOffersForAttendee(attendeeId, now) {
      return database.prepare(`
        SELECT offers.*, entries.attendee_name
        FROM waitlist_offers AS offers
        JOIN waitlist_entries AS entries ON entries.id = offers.waitlist_entry_id
        WHERE offers.attendee_id = ? AND offers.status = 'offered' AND offers.expires_at > ?
        ORDER BY offers.expires_at, offers.id
      `).all(attendeeId, now).map(mapWaitlistOffer);
    },

    async listExpiredWaitlistOffers(now) {
      return database.prepare(`
        SELECT * FROM waitlist_offers
        WHERE status = 'offered' AND expires_at <= ?
        ORDER BY expires_at, id
      `).all(now).map(mapWaitlistOffer);
    },

    async expireWaitlistOffer(id, now) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const offerRow = database.prepare(`
          SELECT * FROM waitlist_offers
          WHERE id = ? AND status = 'offered' AND expires_at <= ?
        `).get(id, now);
        if (!offerRow) {
          database.exec('COMMIT');
          return null;
        }
        const result = database.prepare(`
          UPDATE waitlist_offers SET status = 'expired'
          WHERE id = ? AND status = 'offered' AND expires_at <= ?
        `).run(id, now);
        if (result.changes !== 1) {
          database.exec('COMMIT');
          return null;
        }
        database.prepare(`
          UPDATE waitlist_entries SET status = 'expired'
          WHERE id = ? AND status = 'offered'
        `).run(offerRow.waitlist_entry_id);
        const release = database.prepare(`
          UPDATE ticket_tiers SET sold = sold - ?
          WHERE event_id = ? AND id = ? AND sold >= ?
        `).run(offerRow.quantity, offerRow.event_id, offerRow.tier_id, offerRow.quantity);
        if (release.changes !== 1) {
          throw new DomainError('INVALID_STATE', 'The expired offer seats could not be released.');
        }
        database.exec('COMMIT');
        return mapWaitlistOffer({ ...offerRow, status: 'expired' });
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    async acceptWaitlistOffer(id, attendeeId, now, booking) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const offerRow = database.prepare(`
          SELECT * FROM waitlist_offers
          WHERE id = ? AND attendee_id = ? AND status = 'offered' AND expires_at > ?
        `).get(id, attendeeId, now);
        if (!offerRow) {
          database.exec('COMMIT');
          return null;
        }
        ensureUser(booking.userId, 'attendee');
        insertBookingRow.run(
          booking.id,
          booking.reference,
          booking.userId,
          booking.eventId,
          booking.tierId,
          booking.attendeeName,
          booking.quantity,
          booking.totalCents,
          booking.refundedCents ?? 0,
          booking.holdExpiresAt ?? null,
          booking.holdExpired ? 1 : 0,
          booking.status,
        );
        const accepted = database.prepare(`
          UPDATE waitlist_offers
          SET status = 'accepted', booking_reference = ?
          WHERE id = ? AND attendee_id = ? AND status = 'offered' AND expires_at > ?
        `).run(booking.reference, id, attendeeId, now);
        if (accepted.changes !== 1) {
          database.exec('ROLLBACK');
          return null;
        }
        database.prepare(`
          UPDATE waitlist_entries SET status = 'accepted'
          WHERE id = ? AND status = 'offered'
        `).run(offerRow.waitlist_entry_id);
        database.exec('COMMIT');
        return booking;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
