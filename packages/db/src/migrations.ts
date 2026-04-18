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
  {
    id: "0002_account_external_keys",
    sql: `
      CREATE TABLE account_external_keys (
        external_key TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL REFERENCES accounts(id),
        linked_at    INTEGER NOT NULL
      );
      CREATE INDEX account_external_keys_account_idx
        ON account_external_keys (account_id);
    `,
  },
  {
    id: "0003_duplicate_dismissals",
    sql: `
      CREATE TABLE duplicate_dismissals (
        member_key   TEXT PRIMARY KEY,
        member_ids   TEXT NOT NULL,
        dismissed_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: "0004_transactions_fingerprint_idx",
    sql: `
      CREATE INDEX transactions_fingerprint_idx
        ON transactions (account_id, posted_at, amount_minor, currency);
    `,
  },
  {
    id: "0005_investments",
    sql: `
      CREATE TABLE instruments (
        id         TEXT PRIMARY KEY,
        symbol     TEXT NOT NULL,
        name       TEXT NOT NULL,
        kind       TEXT NOT NULL,
        currency   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE investment_accounts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        institution TEXT,
        currency    TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        archived_at INTEGER
      );

      CREATE TABLE lots (
        id                          TEXT PRIMARY KEY,
        account_id                  TEXT NOT NULL REFERENCES investment_accounts(id),
        instrument_id               TEXT NOT NULL REFERENCES instruments(id),
        opened_at                   INTEGER NOT NULL,
        original_quantity           INTEGER NOT NULL,
        remaining_quantity          INTEGER NOT NULL,
        original_cost_basis_minor   INTEGER NOT NULL,
        remaining_cost_basis_minor  INTEGER NOT NULL,
        currency                    TEXT NOT NULL
      );
      CREATE INDEX lots_account_instrument_idx
        ON lots (account_id, instrument_id);
      CREATE INDEX lots_fifo_idx
        ON lots (account_id, instrument_id, opened_at, id);

      CREATE TABLE holdings (
        account_id        TEXT NOT NULL REFERENCES investment_accounts(id),
        instrument_id     TEXT NOT NULL REFERENCES instruments(id),
        quantity          INTEGER NOT NULL,
        cost_basis_minor  INTEGER NOT NULL,
        currency          TEXT NOT NULL,
        PRIMARY KEY (account_id, instrument_id)
      );
      CREATE INDEX holdings_account_idx ON holdings (account_id);

      CREATE TABLE investment_transactions (
        id                    TEXT PRIMARY KEY,
        account_id            TEXT NOT NULL REFERENCES investment_accounts(id),
        instrument_id         TEXT REFERENCES instruments(id),
        kind                  TEXT NOT NULL,
        posted_at             INTEGER NOT NULL,
        quantity              INTEGER,
        price_per_share_minor INTEGER,
        fees_minor            INTEGER,
        amount_minor          INTEGER NOT NULL,
        split_numerator       INTEGER,
        split_denominator     INTEGER,
        currency              TEXT NOT NULL,
        created_at            INTEGER NOT NULL
      );
      CREATE INDEX investment_transactions_account_posted_idx
        ON investment_transactions (account_id, posted_at);

      CREATE TABLE price_quotes (
        instrument_id TEXT NOT NULL REFERENCES instruments(id),
        as_of         INTEGER NOT NULL,
        price_minor   INTEGER NOT NULL,
        currency      TEXT NOT NULL,
        recorded_at   INTEGER NOT NULL,
        PRIMARY KEY (instrument_id, as_of)
      );
    `,
  },
  {
    id: "0006_investment_account_external_keys",
    sql: `
      CREATE TABLE investment_account_external_keys (
        external_key TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL REFERENCES investment_accounts(id),
        linked_at    INTEGER NOT NULL
      );
      CREATE INDEX investment_account_external_keys_account_idx
        ON investment_account_external_keys (account_id);
    `,
  },
  {
    id: "0007_investment_transactions_memo",
    sql: `
      ALTER TABLE investment_transactions ADD COLUMN memo TEXT;
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
