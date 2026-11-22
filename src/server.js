import { config } from './config.js';
import { createDatabase } from './db/connection.js';
import { createSqliteRepository } from './repositories/sqlite.js';
import { createEventService } from './services/eventService.js';
import { createBookingService } from './services/bookingService.js';
import { createMockPaymentGateway } from './lib/mockPaymentGateway.js';
import { registerApiRoutes } from './http/apiRoutes.js';
import { createAuthService } from './services/authService.js';
import { registerAuthRoutes } from './routes/auth.js';
import { createApp } from './http/app.js';

const database = createDatabase();
const repository = createSqliteRepository(database);
const eventService = createEventService(repository);
const bookingService = createBookingService(repository, createMockPaymentGateway());
const authService = createAuthService(repository, config.jwtSecret);
const app = createApp({
  configureRouter(router) {
    registerAuthRoutes(router, authService, config.jwtSecret);
    registerApiRoutes(router, eventService, bookingService, config.jwtSecret);
  },
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
