import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { asc, count, desc } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import type { DeviceId, Hlc } from "@worth/domain"
import { EXPORT_VERSION, HlcClock, type ExportFile } from "@worth/sync"
import { EventLog } from "../EventLog"
import { applyEvent } from "../events/apply"
import { decodeEvent } from "../events/encode"

export { EXPORT_VERSION, type ExportFile }

export interface SystemStats {
  readonly deviceId: DeviceId
  readonly eventCount: number
  readonly accountCount: number
  readonly transactionCount: number
  readonly categoryCount: number
  readonly lastHlc: Hlc | null
}

export class SystemService extends Context.Service<
  SystemService,
  {
    readonly stats: Effect.Effect<SystemStats>
    readonly exportLog: Effect.Effect<ExportFile>
    readonly importLog: (
      file: ExportFile,
    ) => Effect.Effect<{ readonly accepted: number; readonly skipped: number }>
    readonly rebuildProjections: Effect.Effect<{ readonly replayed: number }>
  }
>()("@worth/core/SystemService") {}

export const SystemServiceLive = Layer.effect(SystemService)(
  Effect.gen(function* () {
    const db = yield* Db
    const clock = yield* HlcClock
    const log = yield* EventLog

    const countOf = (table: SQLiteTable): number => {
      const row = db.drizzle.select({ n: count() }).from(table).get()
      return row?.n ?? 0
    }

    const stats: Effect.Effect<SystemStats> = Effect.sync(() => {
      const latest = db.drizzle
        .select({ hlc: schema.events.hlc })
        .from(schema.events)
        .orderBy(desc(schema.events.hlc))
        .limit(1)
        .get()
      return {
        deviceId: clock.deviceId,
        eventCount: countOf(schema.events),
        accountCount: countOf(schema.accounts),
        transactionCount: countOf(schema.transactions),
        categoryCount: countOf(schema.categories),
        lastHlc: (latest?.hlc ?? null) as Hlc | null,
      }
    })

    const exportLog: Effect.Effect<ExportFile> = Effect.gen(function* () {
      const records = yield* log.listRecordsSince(null)
      return {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        deviceId: clock.deviceId,
        events: records,
      }
    })

    const importLog = (
      file: ExportFile,
    ): Effect.Effect<{ accepted: number; skipped: number }> =>
      log.ingest(file.events)

    /**
     * Truncate every projection table, then replay the entire event log in HLC
     * order. Foreign-key enforcement is temporarily disabled because the wipe
     * briefly removes referenced rows before we repopulate them.
     */
    const rebuildProjections: Effect.Effect<{ replayed: number }> = Effect.sync(() => {
      db.sqlite.pragma("foreign_keys = OFF")
      try {
        let replayed = 0
        db.drizzle.transaction((tx) => {
          tx.delete(schema.transactions).run()
          tx.delete(schema.categories).run()
          tx.delete(schema.accounts).run()
          const rows = tx
            .select()
            .from(schema.events)
            .orderBy(asc(schema.events.hlc))
            .all()
          for (const row of rows) {
            applyEvent(tx, decodeEvent(row.payload))
            replayed++
          }
        })
        return { replayed }
      } finally {
        db.sqlite.pragma("foreign_keys = ON")
      }
    })

    return { stats, exportLog, importLog, rebuildProjections }
  }),
)
