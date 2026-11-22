import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
export const defaultDatabasePath = fileURLToPath(
  new URL('../../data/ticketing.sqlite', import.meta.url),
);

export function createDatabase(databasePath = defaultDatabasePath) {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(readFileSync(schemaPath, 'utf8'));
  const userColumns = database.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'password_hash')) {
    database.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  const bookingColumns = database.prepare('PRAGMA table_info(bookings)').all();
  if (!bookingColumns.some((column) => column.name === 'refunded_cents')) {
    database.exec('ALTER TABLE bookings ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0)');
  }
  if (!bookingColumns.some((column) => column.name === 'hold_expires_at')) {
    database.exec('ALTER TABLE bookings ADD COLUMN hold_expires_at TEXT');
  }
  if (!bookingColumns.some((column) => column.name === 'hold_expired')) {
    database.exec('ALTER TABLE bookings ADD COLUMN hold_expired INTEGER NOT NULL DEFAULT 0 CHECK (hold_expired IN (0, 1))');
  }
  return database;
}
