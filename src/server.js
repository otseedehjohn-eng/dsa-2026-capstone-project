import { config } from './config.js';
import { createMemoryRepository } from './repositories/memory.js';
import { createEventService } from './services/eventService.js';
import { createBookingService } from './services/bookingService.js';
import { createMockPaymentGateway } from './lib/mockPaymentGateway.js';
import { registerApiRoutes } from './http/apiRoutes.js';
import { createApp } from './http/app.js';

const repository = createMemoryRepository();
const eventService = createEventService(repository);
const bookingService = createBookingService(repository, createMockPaymentGateway());
const app = createApp({
  configureRouter(router) {
    registerApiRoutes(router, eventService, bookingService);
  },
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
