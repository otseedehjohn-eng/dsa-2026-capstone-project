# API examples

The app stores data in SQLite. Set different private secrets for login tokens
and ticket codes before starting the server. In PowerShell, generate them with:

```powershell
$env:JWT_SECRET = node -p "require('node:crypto').randomBytes(32).toString('base64url')"
$env:TICKET_TOKEN_SECRET = node -p "require('node:crypto').randomBytes(32).toString('base64url')"
npm start
```

Keep both secrets private and use the same values after restarting the server.

## Sign up and log in

```sh
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H "content-type: application/json" \
  -d '{"email":"organizer@example.com","password":"example-pass-123","role":"organizer"}'
```

The response contains a signed `token` and a public `user` object. Copy the
token for protected requests; the password is never returned.

```sh
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"organizer@example.com","password":"example-pass-123"}'
```

## Create and publish an event

```sh
curl -i -X POST http://localhost:3000/api/events \
  -H "content-type: application/json" \
  -H "authorization: Bearer ORGANIZER_TOKEN" \
  -d '{"title":"Lagos Tech Meetup","city":"Lagos","venue":"Civic Centre","date":"2026-12-05T17:00:00Z"}'
```

Save the returned event `id`.

```sh
curl -i -X POST http://localhost:3000/api/events/EVENT_ID/tiers \
  -H "content-type: application/json" \
  -H "authorization: Bearer ORGANIZER_TOKEN" \
  -d '{"name":"General","priceCents":5000,"capacity":100}'
```

Save the returned tier `id`, then publish:

```sh
curl -i -X POST http://localhost:3000/api/events/EVENT_ID/publish \
  -H "authorization: Bearer ORGANIZER_TOKEN"
```

The organizer dashboard can list only the signed-in organizer's own events:

```sh
curl -i http://localhost:3000/api/organizer/events \
  -H "authorization: Bearer ORGANIZER_TOKEN"
```

## Browse events

Event search and event details are public:

```sh
curl -i "http://localhost:3000/api/events?q=tech&city=lagos&maxPriceCents=10000&sort=date"
curl -i http://localhost:3000/api/events/EVENT_ID
```

## Book, pay and view tickets

Sign up or log in as an attendee and use that response's token:

```sh
curl -i -X POST http://localhost:3000/api/bookings \
  -H "content-type: application/json" \
  -H "authorization: Bearer ATTENDEE_TOKEN" \
  -d '{"eventId":"EVENT_ID","tierId":"TIER_ID","attendeeName":"Ada","quantity":2}'
```

Only the attendee who made the booking can read, pay or cancel it. A different
attendee gets `NOT_FOUND` for a booking reference.

```sh
curl -i http://localhost:3000/api/bookings \
  -H "authorization: Bearer ATTENDEE_TOKEN"

curl -i http://localhost:3000/api/bookings/BOOKING_REFERENCE \
  -H "authorization: Bearer ATTENDEE_TOKEN"

curl -i -X POST http://localhost:3000/api/bookings/BOOKING_REFERENCE/pay \
  -H "content-type: application/json" \
  -H "authorization: Bearer ATTENDEE_TOKEN" \
  -d '{"decline":false}'
```

To try a declined mock payment, send `{"decline":true}`. The booking stays
pending and can be paid again before its 10-minute hold expires.

For a paid booking, fetch its signed ticket code. It contains only the booking
reference and issue time:

```sh
curl -i http://localhost:3000/api/bookings/BOOKING_REFERENCE/ticket-token \
  -H "authorization: Bearer ATTENDEE_TOKEN"
```

Staff submit the code with the event being checked in. The booking is admitted
only once; later scans return `DUPLICATE_SCAN` with the first check-in time.

```sh
curl -i -X POST http://localhost:3000/api/checkin \
  -H "content-type: application/json" \
  -H "authorization: Bearer STAFF_TOKEN" \
  -d '{"ticketToken":"SIGNED_TICKET_CODE","eventId":"EVENT_ID"}'
```

```sh
curl -i http://localhost:3000/api/bookings/BOOKING_REFERENCE/refund \
  -H "authorization: Bearer ATTENDEE_TOKEN"
```

For paid bookings, preview the current refund amount before confirming the
cancellation. Then submit it:

```sh
curl -i -X POST http://localhost:3000/api/bookings/BOOKING_REFERENCE/cancel \
  -H "authorization: Bearer ATTENDEE_TOKEN"
```

## Waitlist

Join a sold-out tier with one ticket requested per attendee:

```sh
curl -i -X POST http://localhost:3000/api/waitlist \
  -H "content-type: application/json" \
  -H "authorization: Bearer ATTENDEE_TOKEN" \
  -d '{"eventId":"EVENT_ID","tierId":"TIER_ID","attendeeName":"Ada"}'
```

List your active offers and accept one before its 10-minute deadline:

```sh
curl -i http://localhost:3000/api/waitlist/offers \
  -H "authorization: Bearer ATTENDEE_TOKEN"

curl -i -X POST http://localhost:3000/api/waitlist/OFFER_ID/accept \
  -H "authorization: Bearer ATTENDEE_TOKEN"
```

## Check the current account

```sh
curl -i http://localhost:3000/api/auth/me \
  -H "authorization: Bearer ATTENDEE_TOKEN"
```
