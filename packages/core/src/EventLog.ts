import { asc, eq, gt } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import type { DeviceId, DomainEvent, EventId, Hlc } from "@worth/domain"
import { HLC, HlcClock, newEventId, type SyncEvent } from "@worth/sync"
import { applyEvent } from "./events/apply"
import { decodeEvent, encodeEvent } from "./events/encode"

export interface StoredEvent {
  readonly eventId: EventId
  readonly hlc: Hlc
  readonly deviceId: DeviceId
  readonly createdAt: number
  readonly event: DomainEvent
}

/** Alias for {@link SyncEvent}: the wire shape of one row in the `events` table. */
export type EventRecord = SyncEvent

export class EventLog extends Context.Service<
  EventLog,
  {
    readonly append: (event: DomainEvent) => Effect.Effect<StoredEvent>
    readonly appendAll: (events: readonly DomainEvent[]) => Effect.Effect<readonly StoredEvent[]>
    readonly ingest: (
      records: readonly EventRecord[],
    ) => Effect.Effect<{ readonly accepted: number; readonly skipped: number }>
    readonly list: Effect.Effect<readonly StoredEvent[]>
    readonly listRecordsSince: (hlc: Hlc | null) => Effect.Effect<readonly EventRecord[]>
  }
>()("@worth/core/EventLog") {}

const rowToStored = (row: typeof schema.events.$inferSelect): StoredEvent => ({
  eventId: row.eventId as EventId,
  hlc: row.hlc as Hlc,
  deviceId: row.deviceId as DeviceId,
  createdAt: row.createdAt,
  event: decodeEvent(row.payload),
})

const rowToRecord = (row: typeof schema.events.$inferSelect): EventRecord => ({
  eventId: row.eventId as EventId,
  hlc: row.hlc as Hlc,
  deviceId: row.deviceId as DeviceId,
  type: row.type,
  payload: row.payload,
  createdAt: row.createdAt,
  serverSeq: row.serverSeq,
})

export const EventLogLive = Layer.effect(EventLog)(
  Effect.gen(function* () {
    const db = yield* Db
    const clock = yield* HlcClock

    const append = (event: DomainEvent): Effect.Effect<StoredEvent> =>
      Effect.gen(function* () {
        const hlc = yield* clock.next
        const eventId = newEventId()
        const createdAt = Date.now()
        const payload = encodeEvent(event)

        yield* Effect.sync(() =>
          db.drizzle.transaction((tx) => {
            tx.insert(schema.events)
              .values({
                eventId,
                hlc,
                deviceId: clock.deviceId,
                type: event._tag,
                payload,
                createdAt,
                serverSeq: null,
              })
              .run()
            applyEvent(tx, event)
          }),
        )

        return { eventId, hlc, deviceId: clock.deviceId, createdAt, event }
      })

    /**
     * Bulk path: all events + projections land in a single DB transaction.
     * Used by CSV import and anywhere else we're committing many events at once.
     */
    const appendAll = (events: readonly DomainEvent[]): Effect.Effect<readonly StoredEvent[]> =>
      Effect.gen(function* () {
        if (events.length === 0) return []

        const stored: StoredEvent[] = []
        for (const event of events) {
          const hlc = yield* clock.next
          const eventId = newEventId()
          const createdAt = Date.now()
          stored.push({ eventId, hlc, deviceId: clock.deviceId, createdAt, event })
        }

        yield* Effect.sync(() =>
          db.drizzle.transaction((tx) => {
            const rows = stored.map((s) => ({
              eventId: s.eventId,
              hlc: s.hlc,
              deviceId: s.deviceId,
              type: s.event._tag,
              payload: encodeEvent(s.event),
              createdAt: s.createdAt,
              serverSeq: null,
            }))
            tx.insert(schema.events).values(rows).run()
            for (const s of stored) applyEvent(tx, s.event)
          }),
        )

        return stored
      })

    /**
     * Accept pre-HLC'd events from an external source (export file, future
     * sync pull). Idempotent on event_id. The receiving clock advances past
     * every ingested HLC so future locally-generated events remain ordered
     * after anything we just observed.
     */
    const ingest = (
      records: readonly EventRecord[],
    ): Effect.Effect<{ accepted: number; skipped: number }> =>
      Effect.gen(function* () {
        if (records.length === 0) return { accepted: 0, skipped: 0 }

        // Apply in HLC order so causally-earlier events land before events
        // that reference them (e.g. AccountCreated before TransactionImported).
        const sorted = [...records].sort((a, b) => HLC.compare(a.hlc, b.hlc))

        let accepted = 0
        let skipped = 0

        yield* Effect.sync(() =>
          db.drizzle.transaction((tx) => {
            for (const rec of sorted) {
              const existing = tx
                .select({ id: schema.events.eventId })
                .from(schema.events)
                .where(eq(schema.events.eventId, rec.eventId))
                .get()
              if (existing) {
                skipped++
                continue
              }
              tx.insert(schema.events)
                .values({
                  eventId: rec.eventId,
                  hlc: rec.hlc,
                  deviceId: rec.deviceId,
                  type: rec.type,
                  payload: rec.payload,
                  createdAt: rec.createdAt,
                  serverSeq: rec.serverSeq,
                })
                .run()
              applyEvent(tx, decodeEvent(rec.payload))
              accepted++
            }
          }),
        )

        // Advance the local clock past the latest HLC we just observed.
        for (const rec of sorted) {
          yield* clock.observe(rec.hlc)
        }

        return { accepted, skipped }
      })

    const list = Effect.sync(() => {
      const rows = db.drizzle
        .select()
        .from(schema.events)
        .orderBy(asc(schema.events.hlc))
        .all()
      return rows.map(rowToStored)
    })

    const listRecordsSince = (hlc: Hlc | null): Effect.Effect<readonly EventRecord[]> =>
      Effect.sync(() => {
        const base = db.drizzle.select().from(schema.events)
        const filtered = hlc === null ? base : base.where(gt(schema.events.hlc, hlc))
        return filtered.orderBy(asc(schema.events.hlc)).all().map(rowToRecord)
      })

    return { append, appendAll, ingest, list, listRecordsSince }
  }),
)
