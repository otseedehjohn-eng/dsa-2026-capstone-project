# Architecture

## Layers

```mermaid
flowchart TD
  Client --> Routes
  Routes --> Services
  Services --> DomainRules
  Services --> Repositories
  Repositories --> DataStore
```

- **Routes** may translate HTTP requests and responses, but may not implement business rules or access persistence directly.
- **Services** may coordinate domain rules and repositories, but may not depend on HTTP details or reach upward to routes.
- **Domain rules** may validate and enforce business invariants, but may not depend on services, routes, or storage technology.
- **Repositories** may read and write data, but may not decide business policy or call services and routes.

## Data model

```mermaid
erDiagram
  USERS ||--o{ EVENTS : organizes
  USERS ||--o{ BOOKINGS : makes
  EVENTS ||--|{ TICKET_TIERS : offers
  EVENTS ||--o{ BOOKINGS : receives
  TICKET_TIERS ||--o{ BOOKINGS : reserves

  USERS {
    string id
    string name
    string email
    string role
  }
  EVENTS {
    string id
    string organizer_id
    string title
    string city
    string venue
    datetime date
    boolean published
  }
  TICKET_TIERS {
    string id
    string event_id
    string name
    integer price_cents
    integer capacity
  }
  BOOKINGS {
    string id
    string attendee_id
    string event_id
    string tier_id
    integer quantity
    integer total_cents
    string status
  }
```

## Booking life cycle

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> paid
  pending --> cancelled
  paid --> checked_in
  paid --> refunded
  paid --> cancelled
  cancelled --> [*]
  refunded --> [*]
  checked_in --> [*]
```
