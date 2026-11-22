# AI log

Every time you give an AI tool a significant prompt, add an entry. Three lines each.
"Nothing was wrong" is allowed, but it is rarely true. Your instructor will read this.

## Build 1

### Prompt 1: Build 1 prompt (docs/build-1.md)
- **What I asked:** Create the terminal domain core, readable references, linked-list waitlist, inventory rules, demo and lookup benchmark.
- **What came back:** Added the requested domain modules and scripts; corrected the package module type and npm commands.
- **What was wrong (or "nothing"):** `package.json` had `"type": "modulus"`, which is not a valid Node module type. Changed it to `"module"`; no other prompt rule was unclear.

## Build 2

### Prompt 1: Build 2 prompt (docs/build-2.md)
- **What I asked:** Add stable merge sort, event publishing and summaries, pure event search/filter/sort, and acceptance-criteria tests for S02-S06; add `npm test`.
- **What came back:** Added the domain functions, tests, and test script; added three explicit S04 publishing criteria.
- **What was wrong (or "nothing"):** S04's criteria section was blank despite the prompt asking for tests against criteria written in class. I documented criteria matching the requested publish/unpublish behavior and the required no-tier `INVALID_STATE` rule. No implementation rule remained unclear.

### Prompt 2:
- **What I asked:** Complete Build 4 and verify the working REST API end to end.
- **What came back:** The existing Build 4 implementation already passed the API suite and build 2/3 suites.
- **What was wrong (or "nothing"):** Publish and unpublish changed their domain event objects without explicitly calling `repository.saveEvent`; I added repository persistence calls so the service remains correct if a repository uses copy-on-read storage. No prompt rule was unclear.

## Build 5

### Prompt 1: SQLite persistence and oversell reproduction (docs/build-5.md)
- **What I asked:** Move the repository to SQLite, add constraints, seed and oversell scripts, and keep server data across restarts.
- **What came back:** Added a native `node:sqlite` connection, schema, repository, persistent server wiring, seed command, and concurrent API demo.
- **What was wrong (or "nothing"):** The first implementation needed database-level conditional seat reservation to prevent concurrent requests using stale event snapshots; Prompt 2 specifies and tests that fix. No rule was unclear.

### Prompt 2: Atomic last-seat reservation (docs/build-5.md)
- **What I asked:** Reserve capacity with one conditional database update and prove 50 concurrent requests cannot oversell.
- **What came back:** Added an atomic `UPDATE ... WHERE sold + quantity <= capacity`, the `SOLD_OUT` result, and a 50-request SQLite test.
- **What was wrong (or "nothing"):** The pre-fix demo output was not present in this checkout, so I did not invent a numeric baseline; the stale-read/write approach can create multiple bookings while persisting the same stale sold count. An in-process lock cannot coordinate other server processes, and separate read/write checks allow all callers to observe the same seat before reservation.

## Build 6

### Prompt 1: Frontend on mock data (docs/build-6.md)
- **What I asked:** Build accessible event browsing, event details, ticket selection, a countdown checkout, and mock payment using plain browser modules.
- **What came back:** Added responsive pages, a safe DOM helper, fixture data, a promise-based mock API, and checkout/payment interactions.
- **What was wrong (or "nothing"):** The prompt did not specify the hold duration, so I chose a 10-minute mock hold and make its expiry release the reserved mock seats. No other rule was unclear.

## Build 7

### Prompt 1: Login, roles and a connected app (docs/build-7.md)
- **What I asked:** Add scrypt passwords, expiring HS256 bearer tokens, server-side role and ownership checks, a connected browser app, and auth/privacy tests.
- **What came back:** Added authentication and token modules, SQLite user persistence with a migration, protected routes, login/ticket/organizer pages, and API tests.
- **What was wrong (or "nothing"):** The prompt conflicted with S13 about another attendee's booking; I followed the requested `NOT_FOUND` after confirming with the user, updated S13, removed stale `x-user-id` wording from service errors, and added SQLite-auth and browser bearer-token tests. No other prompt rule was unclear.

## Build 8

### Prompt 1: Refunds, waitlist, expiry and maintenance (docs/build-8.md)
- **What I asked:** Add a controllable clock, tiered refunds, compare-and-set cancellation, FIFO seat offers, unpaid-booking expiry, the browser flows, and focused tests.
- **What came back:** Added refund and waitlist services, SQLite persistence and atomic offer operations, a maintenance job, API endpoints, UI changes, and boundary/concurrency coverage.
- **What was wrong (or "nothing"):** Offer/hold durations and multi-seat allocation were unspecified, so I asked and implemented 10 minutes each with one seat per attendee in FIFO order. I fixed offer acceptance to insert its booking before linking the foreign key, and the optional debugging-exercise file was not present to complete a write-up.

## Build 9

### Prompt 1: QR check-in, CI and security (docs/build-9.md)
- **What I asked:** Add signed privacy-minimal ticket codes, staff-only check-in with an atomic single-use update, security headers, per-IP rate limits, CI, security guidance and tests.
- **What came back:** Added ticket signing and verification, event-scoped staff check-in, atomic SQLite admission, rate limits, security headers, the check-in page, CI, documentation and tests.
- **What was wrong (or "nothing"):** The prompt referenced `public/js/qr.js`, but that encoder was absent from the repository. I asked before substituting an encoder; the user chose to provide the vendored file and defer QR rendering until then. Staff assignment records were also absent, so the user chose staff-role authorization with an event id supplied for each scan.
