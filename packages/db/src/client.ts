import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { Context, Effect, Layer, Scope } from "effect"
import * as schema from "./schema"
import { runMigrations } from "./migrations"

// -- Configuration ----------------------------------------------------------

export class DbConfig extends Context.Service<
  DbConfig,
  {
    readonly filename: string
  }
>()("@worth/db/DbConfig") {}

export const DbConfigLive = (filename: string): Layer.Layer<DbConfig> =>
  Layer.succeed(DbConfig, { filename })

// -- Client -----------------------------------------------------------------

export type DrizzleClient = BetterSQLite3Database<typeof schema>

export class Db extends Context.Service<
  Db,
  {
    readonly drizzle: DrizzleClient
    readonly sqlite: Database.Database
  }
>()("@worth/db/Db") {}

export const DbLive = Layer.effect(Db)(
  Effect.gen(function* () {
    const { filename } = yield* DbConfig
    const scope = yield* Effect.scope

    const sqlite = new Database(filename)
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
