import { config } from './config.js';
import { createDatabase } from './db/connection.js';
import { createSqliteRepository } from './repositories/sqlite.js';
import { createEventService } from './services/eventService.js';
import { createBookingService } from './services/bookingService.js';
import { createMockPaymentGateway } from './lib/mockPaymentGateway.js';
import { createMaintenance } from './jobs/maintenance.js';
import { registerApiRoutes } from './http/apiRoutes.js';
import { createAuthService } from './services/authService.js';
import { createSeatService } from './services/seatService.js';
import { createWaitlistService } from './services/waitlistService.js';
import { createCheckinService } from './services/checkinService.js';
import { registerAuthRoutes } from './routes/auth.js';
import { createApp } from './http/app.js';

const database = createDatabase();
const repository = createSqliteRepository(database);
const eventService = createEventService(repository);
const seatService = createSeatService(repository);
const waitlistService = createWaitlistService(repository);
const bookingService = createBookingService(repository, createMockPaymentGateway(), {
  seatService,
  waitlistService,
});
const checkinService = createCheckinService(repository, config.ticketTokenSecret);
const authService = createAuthService(repository, config.jwtSecret);
const maintenance = createMaintenance({ repository, bookingService, waitlistService });
const app = createApp({
  configureRouter(router) {
    registerAuthRoutes(router, authService, config.jwtSecret);
    registerApiRoutes(
      router,
      eventService,
      bookingService,
      config.jwtSecret,
      waitlistService,
      checkinService,
    );
  },
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

const maintenanceTimer = setInterval(() => {
  maintenance.run().catch((error) => {
    console.error('Maintenance job failed:', error);
  });
}, 60_000);
maintenanceTimer.unref();
