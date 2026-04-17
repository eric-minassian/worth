import { asc } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import type { DeviceId, DomainEvent, EventId, Hlc } from "@worth/domain"
import { HlcClock, newEventId } from "@worth/sync"
import { applyEvent } from "./events/apply"
import { decodeEvent, encodeEvent } from "./events/encode"

export interface StoredEvent {
  readonly eventId: EventId
  readonly hlc: Hlc
  readonly deviceId: DeviceId
  readonly createdAt: number
  readonly event: DomainEvent
}

export class EventLog extends Context.Service<
  EventLog,
  {
    readonly append: (event: DomainEvent) => Effect.Effect<StoredEvent>
    readonly list: Effect.Effect<readonly StoredEvent[]>
  }
>()("@worth/core/EventLog") {}

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

    const list = Effect.sync(() => {
      const rows = db.drizzle
        .select()
        .from(schema.events)
        .orderBy(asc(schema.events.hlc))
        .all()
      return rows.map<StoredEvent>((row) => ({
        eventId: row.eventId as EventId,
        hlc: row.hlc as Hlc,
        deviceId: row.deviceId as DeviceId,
        createdAt: row.createdAt,
        event: decodeEvent(row.payload),
      }))
    })

    return { append, list }
  }),
)
