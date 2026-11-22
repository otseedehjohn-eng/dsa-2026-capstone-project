# Security checklist

- [ ] Keep `.env` out of Git; use separate random values of at least 32 bytes for `JWT_SECRET` and `TICKET_TOKEN_SECRET`.
- [ ] Store password hashes only. Never log or return passwords.
- [ ] Keep signed ticket payloads limited to the booking reference and issue time; verify their HMAC before looking up a booking.
- [ ] Restrict check-in to staff, match the selected event, reject inactive tickets, and admit each paid booking with one atomic database update.
- [ ] Apply per-IP rate limits to login and check-in attempts.
- [ ] Send a restrictive Content-Security-Policy, `X-Content-Type-Options: nosniff`, and `Referrer-Policy`; keep scripts external.
