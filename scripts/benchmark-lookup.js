import { performance } from 'node:perf_hooks';

const BOOKING_COUNT = 100_000;
const LOOKUP_COUNT = 500;
const bookings = Array.from({ length: BOOKING_COUNT }, (_, index) => ({
  reference: `BOOK-${String(index).padStart(6, '0')}`,
  attendeeName: `Attendee ${index}`,
}));
const bookingsByReference = new Map(
  bookings.map((booking) => [booking.reference, booking]),
);
const references = Array.from(
  { length: LOOKUP_COUNT },
  () => bookings[BOOKING_COUNT - 1].reference,
);

let arrayMatches = 0;
const arrayStart = performance.now();
for (const reference of references) {
  if (bookings.find((booking) => booking.reference === reference)) {
    arrayMatches += 1;
  }
}
const arrayDuration = performance.now() - arrayStart;

let mapMatches = 0;
const mapStart = performance.now();
for (const reference of references) {
  if (bookingsByReference.get(reference)) {
    mapMatches += 1;
  }
}
const mapDuration = performance.now() - mapStart;

if (arrayMatches !== LOOKUP_COUNT || mapMatches !== LOOKUP_COUNT) {
  throw new Error('The benchmark failed to find every requested booking.');
}

console.log(`Bookings: ${BOOKING_COUNT.toLocaleString()}`);
console.log(`Lookups: ${LOOKUP_COUNT.toLocaleString()}`);
console.log(`Array.find: ${arrayDuration.toFixed(2)} ms (O(n) per lookup)`);
console.log(`Map.get:    ${mapDuration.toFixed(2)} ms (O(1) average per lookup)`);
