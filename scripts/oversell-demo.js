import { once } from 'node:events';
import { createDatabase } from '../src/db/connection.js';
import { createApp } from '../src/http/app.js';
import { registerApiRoutes } from '../src/http/apiRoutes.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createEventService } from '../src/services/eventService.js';

const database = createDatabase(':memory:');
const repository = createSqliteRepository(database);
const eventService = createEventService(repository);
const bookingService = createBookingService(repository, createMockPaymentGateway());
const server = createApp({
  configureRouter(router) {
    registerApiRoutes(router, eventService, bookingService);
  },
});

try {
  const event = await eventService.create('demo-organizer', {
    title: 'Last Seat Demo',
    city: 'Lagos',
    venue: 'Civic Centre',
    date: '2027-01-15T17:00:00Z',
  });
  const tier = await eventService.addTier('demo-organizer', event.id, {
    name: 'Last Seat',
    priceCents: 1000,
    capacity: 1,
  });
  await eventService.publish('demo-organizer', event.id);

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const attempts = await Promise.all(Array.from({ length: 50 }, (_, index) => (
    fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': `demo-attendee-${index}`,
      },
      body: JSON.stringify({
        eventId: event.id,
        tierId: tier.id,
        attendeeName: `Attendee ${index}`,
        quantity: 1,
      }),
    }).then(async (response) => ({
      status: response.status,
      body: await response.json(),
    }))
  )));
  const successes = attempts.filter(({ status }) => status === 201).length;
  const soldOut = attempts.filter(({ body }) => body.error?.code === 'SOLD_OUT').length;
  const savedTier = await repository.findTier(event.id, tier.id);

  console.log(`Concurrent booking attempts: ${attempts.length}`);
  console.log(`Bookings succeeded: ${successes}`);
  console.log(`Rejected as SOLD_OUT: ${soldOut}`);
  console.log(`Seats sold: ${savedTier.sold}/${savedTier.capacity}`);
} finally {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  database.close();
}
