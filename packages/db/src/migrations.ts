import type Database from "better-sqlite3"

export interface Migration {
  readonly id: string
  readonly sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_initial",
    sql: `
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE events (
        event_id   TEXT PRIMARY KEY,
        hlc        TEXT NOT NULL,
        device_id  TEXT NOT NULL,
        type       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        server_seq INTEGER
      );
      CREATE INDEX events_hlc_idx ON events (hlc);
      CREATE INDEX events_server_seq_idx ON events (server_seq);

      CREATE TABLE accounts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        currency    TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        archived_at INTEGER
      );

      CREATE TABLE categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        parent_id  TEXT REFERENCES categories(id),
        color      TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE transactions (
        id           TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL REFERENCES accounts(id),
        posted_at    INTEGER NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency     TEXT NOT NULL,
        payee        TEXT NOT NULL,
        memo         TEXT,
        category_id  TEXT REFERENCES categories(id),
        import_hash  TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX transactions_account_posted_idx
        ON transactions (account_id, posted_at);
      CREATE UNIQUE INDEX transactions_import_hash_idx
        ON transactions (account_id, import_hash)
        WHERE import_hash IS NOT NULL;
    `,
  },
]

/**
 * Apply all pending migrations, tracked in `_migrations`. Each migration is
 * applied inside a transaction that also inserts its id, so we never end up
 * with partially-applied schema.
 */
export const runMigrations = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)
  const applied = new Set(
    db.prepare<[], { id: string }>("SELECT id FROM _migrations").all().map((r) => r.id),
  )
  const insert = db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      insert.run(migration.id, Date.now())
    })
    apply()
  }
}
