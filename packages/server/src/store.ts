import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Where games are kept between restarts: one JSON document per room. */
export interface Store {
  put(id: string, data: string): void;
  remove(id: string): void;
  all(): { id: string; data: string }[];
  close(): void;
}

/** Keeps nothing past the process; for tests, and when persistence is off. */
export function memoryStore(): Store {
  const rows = new Map<string, string>();
  return {
    put: (id, data) => void rows.set(id, data),
    remove: (id) => void rows.delete(id),
    all: () => [...rows].map(([id, data]) => ({ id, data })),
    close: () => {},
  };
}

/** A SQLite file (created if missing), written through on every change. */
export function sqliteStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated INTEGER NOT NULL
    );
  `);
  const put = db.prepare(
    'INSERT INTO rooms (id, data, updated) VALUES (?, ?, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated = excluded.updated',
  );
  const remove = db.prepare('DELETE FROM rooms WHERE id = ?');
  const all = db.prepare('SELECT id, data FROM rooms');
  return {
    put: (id, data) => void put.run(id, data, Date.now()),
    remove: (id) => void remove.run(id),
    all: () => all.all() as { id: string; data: string }[],
    close: () => db.close(),
  };
}
