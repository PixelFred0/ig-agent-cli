import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { dataDir } from "../config/store.ts";

const req = createRequire(import.meta.url);

export interface Statement<Row = unknown> {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  all(...params: unknown[]): Row[];
  get(...params: unknown[]): Row | undefined;
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare<Row = unknown>(sql: string): Statement<Row>;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

export function defaultDbPath(): string {
  return join(dataDir(), "cache.db");
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS accounts (
  ig_user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  page_id TEXT,
  connected_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(ig_user_id),
  media_type TEXT,
  media_product_type TEXT,
  caption TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  timestamp INTEGER,
  raw_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS media_account_ts_idx ON media(account_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS media_product_type_idx ON media(media_product_type);

CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id TEXT NOT NULL REFERENCES media(id),
  metric TEXT NOT NULL,
  value REAL,
  value_json TEXT,
  period TEXT,
  fetched_at INTEGER NOT NULL,
  UNIQUE(media_id, metric, period, fetched_at)
);

CREATE INDEX IF NOT EXISTS insights_media_idx ON insights(media_id);

CREATE TABLE IF NOT EXISTS sync_state (
  account_id TEXT PRIMARY KEY REFERENCES accounts(ig_user_id),
  last_cursor TEXT,
  last_synced_at INTEGER NOT NULL
);
`;

export interface OpenDbOpts {
  path?: string;
  memory?: boolean;
}

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

function normalizeBunParams(params: unknown[]): unknown[] {
  if (params.length !== 1) return params;
  const [p] = params;
  if (!p || typeof p !== "object" || Array.isArray(p)) return params;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    out[k.startsWith("@") || k.startsWith("$") || k.startsWith(":") ? k : `@${k}`] = v;
  }
  return [out];
}

function openBunSqlite(path: string): SqliteDb {
  const { Database } = req("bun:sqlite") as typeof import("bun:sqlite");
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: <Row>(sql: string): Statement<Row> => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          const res = (stmt.run as (...a: unknown[]) => { changes: number; lastInsertRowid: number | bigint })(
            ...normalizeBunParams(params),
          );
          return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
        },
        all: (...params: unknown[]) =>
          (stmt.all as (...a: unknown[]) => unknown[])(...normalizeBunParams(params)) as Row[],
        get: (...params: unknown[]) =>
          (stmt.get as (...a: unknown[]) => unknown)(...normalizeBunParams(params)) as Row | undefined,
      };
    },
    transaction: <T extends (...args: any[]) => any>(fn: T) => db.transaction(fn) as unknown as T,
    close: () => db.close(),
  };
}

function openBetterSqlite(path: string): SqliteDb {
  const Database = req("better-sqlite3") as unknown as new (p: string) => import("better-sqlite3").Database;
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return {
    exec: (sql: string) => {
      db.exec(sql);
    },
    prepare: <Row>(sql: string): Statement<Row> => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          const res = stmt.run(...(params as never[]));
          return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
        },
        all: (...params: unknown[]) => stmt.all(...(params as never[])) as Row[],
        get: (...params: unknown[]) => stmt.get(...(params as never[])) as Row | undefined,
      };
    },
    transaction: <T extends (...args: any[]) => any>(fn: T) => db.transaction(fn) as unknown as T,
    close: () => db.close(),
  };
}

export function openDb(opts: OpenDbOpts = {}): SqliteDb {
  let dbPath: string;
  if (opts.memory) {
    dbPath = ":memory:";
  } else {
    dbPath = opts.path ?? defaultDbPath();
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = isBun() ? openBunSqlite(dbPath) : openBetterSqlite(dbPath);
  db.exec(MIGRATION);
  if (!opts.memory && dbPath !== ":memory:") {
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      // Windows or a filesystem without POSIX perms — best-effort only.
    }
  }
  return db;
}
