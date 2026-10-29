# API examples

Start the server with `npm start`. The API keeps data in memory, so restart it
to clear events and bookings. Replace `organizer-1` and `attendee-1` with the
caller IDs you want to use.

## Create an event

```sh
curl -i -X POST http://localhost:3000/api/events \
  -H "content-type: application/json" \
  -H "x-user-id: organizer-1" \
  -d '{"title":"Lagos Tech Meetup","city":"Lagos","venue":"Civic Centre","date":"2026-12-05T17:00:00Z"}'
```

Save the returned event `id` for the next requests.

## Add a ticket tier

```sh
curl -i -X POST http://localhost:3000/api/events/EVENT_ID/tiers \
  -H "content-type: application/json" \
  -H "x-user-id: organizer-1" \
  -d '{"name":"General","priceCents":5000,"capacity":100}'
```

Save the returned tier `id` for booking.

## Publish the event

```sh
curl -i -X POST http://localhost:3000/api/events/EVENT_ID/publish \
  -H "x-user-id: organizer-1"
```

## Search, filter and sort events

```sh
curl -i "http://localhost:3000/api/events?q=tech&city=lagos&from=2026-12-01&to=2026-12-31&maxPriceCents=10000&onlyAvailable=true&sort=date"
```

Supported query parameters are `q`, `city`, `from`, `to`, `maxPriceCents`,
`onlyAvailable` (`true` or `false`), and `sort` (`date`, `price`, or
`availability`).

## Book tickets

```sh
curl -i -X POST http://localhost:3000/api/bookings \
  -H "content-type: application/json" \
  -H "x-user-id: attendee-1" \
  -d '{"eventId":"EVENT_ID","tierId":"TIER_ID","attendeeName":"Ada","quantity":2}'
```

Save the returned booking `reference` for payment or cancellation.

## Pay for a booking

```sh
curl -i -X POST http://localhost:3000/api/bookings/BOOKING_REFERENCE/pay \
  -H "content-type: application/json" \
  -H "x-user-id: attendee-1" \
  -d '{"decline":false}'
```

To simulate a decline without providing card data, send `{"decline":true}`.
The booking remains pending and can be retried.

## Cancel an unpaid booking

```sh
curl -i -X POST http://localhost:3000/api/bookings/BOOKING_REFERENCE/cancel \
  -H "x-user-id: attendee-1"
```

## Unpublish an event

```sh
curl -i -X POST http://localhost:3000/api/events/EVENT_ID/unpublish \
  -H "x-user-id: organizer-1"
```
