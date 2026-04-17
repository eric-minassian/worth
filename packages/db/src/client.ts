import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { Context, Data, Effect, Layer, Scope } from "effect"
import * as schema from "./schema"
import { runMigrations } from "./migrations"

// -- Configuration ----------------------------------------------------------

export class DbConfig extends Context.Service<
  DbConfig,
  {
    readonly filename: string
    readonly password: string
  }
>()("@worth/db/DbConfig") {}

export const DbConfigLive = (filename: string, password: string): Layer.Layer<DbConfig> =>
  Layer.succeed(DbConfig, { filename, password })

// -- Errors -----------------------------------------------------------------

export class DbUnlockError extends Data.TaggedError("DbUnlockError")<{
  readonly reason: "wrong-password" | "corrupt"
  readonly message: string
}> {}

// -- Client -----------------------------------------------------------------

export type DrizzleClient = BetterSQLite3Database<typeof schema>

export class Db extends Context.Service<
  Db,
  {
    readonly drizzle: DrizzleClient
    readonly sqlite: Database.Database
  }
>()("@worth/db/Db") {}

/**
 * SQLite string-literal escape: single-quote doubling. The password goes into
 * `PRAGMA key = '...'`, which is a literal — not a bound parameter — so we
 * must escape quotes ourselves. Everything else is bytes-in-bytes-out.
 */
const escapeSqlLiteral = (value: string): string => value.replace(/'/g, "''")

export const DbLive = Layer.effect(Db)(
  Effect.gen(function* () {
    const { filename, password } = yield* DbConfig
    const scope = yield* Effect.scope

    const sqlite = new Database(filename)
    // In-memory and temporary databases have no on-disk presence, so
    // SQLCipher rejects PRAGMA key on them. They're only used by tests, where
    // encryption adds no value. Every real user path hits a file-backed DB.
    const isEphemeral = filename === ":memory:" || filename === ""
    if (!isEphemeral) {
      try {
        sqlite.pragma(`key = '${escapeSqlLiteral(password)}'`)
        // Probe: if the key is wrong, any read from sqlite_master throws
        // "file is not a database".
        sqlite.prepare("SELECT count(*) FROM sqlite_master").get()
      } catch (cause) {
        sqlite.close()
        const message = cause instanceof Error ? cause.message : String(cause)
        const reason = message.includes("not a database") ? "wrong-password" : "corrupt"
        return yield* Effect.fail(new DbUnlockError({ reason, message }))
      }
    }

    sqlite.pragma("journal_mode = WAL")
    sqlite.pragma("foreign_keys = ON")

    runMigrations(sqlite)

    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => sqlite.close()),
    )

    const drizzleDb: DrizzleClient = drizzle(sqlite, { schema })
    return { drizzle: drizzleDb, sqlite }
  }),
)
