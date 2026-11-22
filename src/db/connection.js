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
  return database;
}
