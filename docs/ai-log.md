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
