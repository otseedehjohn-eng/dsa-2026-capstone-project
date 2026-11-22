import { createDatabase } from '../src/db/connection.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { createEventService } from '../src/services/eventService.js';

const database = createDatabase();
const repository = createSqliteRepository(database);

try {
  const existingEvents = await repository.listEvents();
  const existingSeed = existingEvents.find((event) => event.title === 'Capstone Seed Event');

  if (existingSeed) {
    console.log(`Seed data already exists (event ${existingSeed.id}).`);
  } else {
    const eventService = createEventService(repository);
    const event = await eventService.create('seed-organizer', {
      title: 'Capstone Seed Event',
      city: 'Lagos',
      venue: 'Civic Centre',
      date: '2027-01-15T17:00:00Z',
    });
    await eventService.addTier('seed-organizer', event.id, {
      name: 'General',
      priceCents: 5000,
      capacity: 100,
    });
    await eventService.publish('seed-organizer', event.id);
    console.log(`Seeded event ${event.id}.`);
  }
} finally {
  database.close();
}
