import {
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  findBookingByReference,
  joinWaitlist,
} from '../src/domain/inventory.js';
import { DomainError } from '../src/domain/errors.js';

const store = createStore();
const event = createEvent(store, {
  title: 'Lagos Summer Festival',
  city: 'Lagos',
  venue: 'Waterfront Arena',
  date: '2026-12-05',
});
const tier = addTier(store, event.id, {
  name: 'General',
  priceCents: 2500,
  capacity: 3,
});

const adaBooking = bookTickets(store, event.id, tier.id, 'Ada', 2);
console.log(`Ada books ${adaBooking.quantity} of ${tier.capacity} seats.`);

try {
  bookTickets(store, event.id, tier.id, 'Bayo', 2);
} catch (error) {
  if (!(error instanceof DomainError) || error.code !== 'SOLD_OUT') {
    throw error;
  }
  console.log(`Bayo is refused: ${error.code} (${error.message})`);
}

bookTickets(store, event.id, tier.id, 'Bayo', 1);
console.log(`Bayo books the last seat. Seats left: ${tier.seatsLeft}.`);

const chika = joinWaitlist(store, event.id, tier.id, 'Chika');
const dan = joinWaitlist(store, event.id, tier.id, 'Dan');
console.log(`${chika.attendeeName} and ${dan.attendeeName} join the waitlist.`);

const foundBooking = findBookingByReference(store, adaBooking.reference);
console.log(`Booking ${foundBooking.reference} belongs to ${foundBooking.attendeeName}.`);

cancelBooking(store, adaBooking.reference);
console.log(`Ada cancels. Seats left: ${tier.seatsLeft}.`);
console.log(`Next in line: ${tier.waitlist.peek().attendeeName}.`);
