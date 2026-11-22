# Build 9 debugging note: rate-limit test setup

## Symptom

The login rate-limit integration test expected the first HTTP request to return
`200`, but it returned `429`.

## Investigation

The test had already called `consume()` twice on the same limiter while testing
its window behavior. The API route then reused that limiter, so its first
request correctly exceeded the configured limit.

## Fix

Use an independent limiter instance for the HTTP integration test. Keep the
unit-level window test separate, then verify the route allows one request and
rejects the next request from the same IP.

## Takeaway

Rate-limit state is intentionally shared between requests handled by one
limiter. Tests that cover separate scenarios must not accidentally share that
state.
