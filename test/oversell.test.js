import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase } from '../src/db/connection.js';
import { DomainError } from '../src/domain/errors.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createEventService } from '../src/services/eventService.js';

async function createOneSeatEvent(repository) {
  const eventService = createEventService(repository);
  const event = await eventService.create('organizer-1', {
    title: 'One Seat Event',
    city: 'Lagos',
    venue: 'Hall',
    date: '2027-01-15',
  });
  const tier = await eventService.addTier('organizer-1', event.id, {
    name: 'General',
    priceCents: 2500,
    capacity: 1,
  });
  await eventService.publish('organizer-1', event.id);
  return { event, tier };
}

test('50 simultaneous SQLite bookings for one seat yield one success and 49 SOLD_OUT', async () => {
  const database = createDatabase(':memory:');
  try {
    const repository = createSqliteRepository(database);
    const { event, tier } = await createOneSeatEvent(repository);
    const bookingService = createBookingService(repository, createMockPaymentGateway());

    const results = await Promise.all(Array.from({ length: 50 }, async (_, index) => {
      try {
        await bookingService.book(`attendee-${index}`, {
          eventId: event.id,
          tierId: tier.id,
          attendeeName: `Attendee ${index}`,
          quantity: 1,
        });
        return 'success';
      } catch (error) {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'SOLD_OUT');
        return error.code;
      }
    }));

    assert.equal(results.filter((result) => result === 'success').length, 1);
    assert.equal(results.filter((result) => result === 'SOLD_OUT').length, 49);
    const savedTier = await repository.findTier(event.id, tier.id);
    assert.equal(savedTier.sold, 1);
    assert.ok(savedTier.sold <= savedTier.capacity);
    assert.equal((await repository.listBookings()).length, 1);
  } finally {
    database.close();
  }
});

test('SQLite data remains available after closing and reopening the database', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ticketing-sqlite-'));
  const databasePath = path.join(directory, 'ticketing.sqlite');
  let database = createDatabase(databasePath);

  try {
    const repository = createSqliteRepository(database);
    const { event } = await createOneSeatEvent(repository);
    database.close();

    database = createDatabase(databasePath);
    const reopenedRepository = createSqliteRepository(database);
    const savedEvent = await reopenedRepository.findEvent(event.id);
    assert.equal(savedEvent.title, 'One Seat Event');
    assert.equal(savedEvent.published, true);
    assert.equal(savedEvent.tiers.size, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite event updates do not overwrite atomic reservations and cancellation releases seats', async () => {
  const database = createDatabase(':memory:');
  try {
    const repository = createSqliteRepository(database);
    const { event, tier } = await createOneSeatEvent(repository);
    const eventService = createEventService(repository);
    const bookingService = createBookingService(repository, createMockPaymentGateway());
    const booking = await bookingService.book('attendee-1', {
      eventId: event.id,
      tierId: tier.id,
      attendeeName: 'Attendee',
      quantity: 1,
    });

    await eventService.unpublish('organizer-1', event.id);
    assert.equal((await repository.findTier(event.id, tier.id)).sold, 1);
    await bookingService.cancel('attendee-1', booking.reference);
    assert.equal((await repository.findTier(event.id, tier.id)).sold, 0);
  } finally {
    database.close();
  }
});
