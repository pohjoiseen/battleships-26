import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ScoreRow {
  id: number;
  board: string;
  name: string;
  score: number;
  /** ScoreDetails as JSON. */
  details: string;
  created: number;
}

/**
 * Where games are kept between restarts (one JSON document per room), and the hi-scores.
 * Scores rank highest first, and the earlier of equal scores first.
 */
export interface Store {
  put(id: string, data: string): void;
  remove(id: string): void;
  all(): { id: string; data: string }[];
  addScore(row: Omit<ScoreRow, 'id' | 'created'>): number;
  renameScore(id: number, name: string): void;
  score(id: number): ScoreRow | undefined;
  topScores(board: string, limit: number): ScoreRow[];
  /** 1 for the best score on its board. */
  rank(id: number): number;
  close(): void;
}

const better = (a: ScoreRow, b: ScoreRow) => b.score - a.score || a.id - b.id;

/** Keeps nothing past the process; for tests, and when persistence is off. */
export function memoryStore(): Store {
  const rows = new Map<string, string>();
  const scores: ScoreRow[] = [];
  const score = (id: number) => scores.find((r) => r.id === id);
  return {
    put: (id, data) => void rows.set(id, data),
    remove: (id) => void rows.delete(id),
    all: () => [...rows].map(([id, data]) => ({ id, data })),
    addScore: (row) => {
      const id = scores.length + 1;
      scores.push({ ...row, id, created: Date.now() });
      return id;
    },
    renameScore: (id, name) => void (score(id) && (score(id)!.name = name)),
    score,
    topScores: (board, limit) =>
      scores
        .filter((r) => r.board === board)
        .sort(better)
        .slice(0, limit)
        .map((r) => ({ ...r })),
    rank: (id) => {
      const me = score(id)!;
      return 1 + scores.filter((r) => r.board === me.board && better(r, me) < 0).length;
    },
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
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY,
      board TEXT NOT NULL,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      details TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scores_by_rank ON scores (board, score DESC, id);
  `);
  const put = db.prepare(
    'INSERT INTO rooms (id, data, updated) VALUES (?, ?, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated = excluded.updated',
  );
  const remove = db.prepare('DELETE FROM rooms WHERE id = ?');
  const all = db.prepare('SELECT id, data FROM rooms');
  const addScore = db.prepare(
    'INSERT INTO scores (board, name, score, details, created) VALUES (?, ?, ?, ?, ?)',
  );
  const renameScore = db.prepare('UPDATE scores SET name = ? WHERE id = ?');
  const score = db.prepare('SELECT * FROM scores WHERE id = ?');
  const top = db.prepare('SELECT * FROM scores WHERE board = ? ORDER BY score DESC, id LIMIT ?');
  const rank = db.prepare(`
    SELECT 1 + COUNT(*) AS rank FROM scores s, scores me
    WHERE me.id = ? AND s.board = me.board
      AND (s.score > me.score OR (s.score = me.score AND s.id < me.id))
  `);
  return {
    put: (id, data) => void put.run(id, data, Date.now()),
    remove: (id) => void remove.run(id),
    all: () => all.all() as { id: string; data: string }[],
    addScore: (r) =>
      Number(addScore.run(r.board, r.name, r.score, r.details, Date.now()).lastInsertRowid),
    renameScore: (id, name) => void renameScore.run(name, id),
    score: (id) => score.get(id) as ScoreRow | undefined,
    topScores: (board, limit) => top.all(board, limit) as unknown as ScoreRow[],
    rank: (id) => (rank.get(id) as { rank: number }).rank,
    close: () => db.close(),
  };
}
