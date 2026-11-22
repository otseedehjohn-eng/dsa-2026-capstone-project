CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'attendee', 'staff')),
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  city TEXT NOT NULL CHECK (length(trim(city)) > 0),
  venue TEXT NOT NULL CHECK (length(trim(venue)) > 0),
  date TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);

CREATE TABLE IF NOT EXISTS ticket_tiers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  sold INTEGER NOT NULL DEFAULT 0,
  CHECK (sold >= 0 AND sold <= capacity),
  UNIQUE (event_id, name),
  UNIQUE (id, event_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  attendee_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  tier_id TEXT NOT NULL,
  attendee_name TEXT NOT NULL CHECK (length(trim(attendee_name)) > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  hold_expires_at TEXT,
  hold_expired INTEGER NOT NULL DEFAULT 0 CHECK (hold_expired IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'checked_in')),
  FOREIGN KEY (tier_id, event_id) REFERENCES ticket_tiers(id, event_id)
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  attendee_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  tier_id TEXT NOT NULL,
  attendee_name TEXT NOT NULL CHECK (length(trim(attendee_name)) > 0),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'offered', 'accepted', 'expired')),
  FOREIGN KEY (tier_id, event_id) REFERENCES ticket_tiers(id, event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_active_attendee_tier
  ON waitlist_entries (attendee_id, event_id, tier_id)
  WHERE status IN ('waiting', 'offered');

CREATE INDEX IF NOT EXISTS waitlist_fifo
  ON waitlist_entries (event_id, tier_id, status, position);

CREATE TABLE IF NOT EXISTS waitlist_offers (
  id TEXT PRIMARY KEY,
  waitlist_entry_id TEXT NOT NULL UNIQUE REFERENCES waitlist_entries(id),
  attendee_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  tier_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('offered', 'accepted', 'expired')),
  booking_reference TEXT REFERENCES bookings(reference),
  FOREIGN KEY (tier_id, event_id) REFERENCES ticket_tiers(id, event_id)
);

CREATE INDEX IF NOT EXISTS waitlist_offer_expiry
  ON waitlist_offers (status, expires_at);

CREATE INDEX IF NOT EXISTS waitlist_offer_attendee
  ON waitlist_offers (attendee_id, status, expires_at);
