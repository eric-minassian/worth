import { Schema } from "effect"
import { DeviceId, EventId, Hlc } from "@worth/domain"

/**
 * Wire representation of one row from the `events` table.
 *
 * This is the canonical shape carried over every sync boundary — the
 * (future) HTTP sync server, the export file, and any future peer-to-peer
 * transport all use the same struct. `payload` stays as the JSON string we
 * persisted so round-tripping never re-encodes domain events.
 */
export const SyncEvent = Schema.Struct({
  eventId: EventId,
  hlc: Hlc,
  deviceId: DeviceId,
  type: Schema.String,
  payload: Schema.String,
  createdAt: Schema.Number,
  serverSeq: Schema.NullOr(Schema.Number),
})
export type SyncEvent = Schema.Schema.Type<typeof SyncEvent>

// -- Client → Server: push ---------------------------------------------------

export const PushRequest = Schema.Struct({
  events: Schema.Array(SyncEvent),
})
export type PushRequest = Schema.Schema.Type<typeof PushRequest>

export const PushResponse = Schema.Struct({
  accepted: Schema.Array(EventId),
})
export type PushResponse = Schema.Schema.Type<typeof PushResponse>

// -- Client → Server: pull ---------------------------------------------------

export const PullRequest = Schema.Struct({
  /** Monotonic `server_seq` the client has already persisted. `null` = full pull. */
  since: Schema.NullOr(Schema.Number),
  limit: Schema.NullOr(Schema.Number),
})
export type PullRequest = Schema.Schema.Type<typeof PullRequest>

export const PullResponse = Schema.Struct({
  events: Schema.Array(SyncEvent),
  /** `server_seq` to use on the next pull, or `null` when caught up. */
  nextCursor: Schema.NullOr(Schema.Number),
  done: Schema.Boolean,
})
export type PullResponse = Schema.Schema.Type<typeof PullResponse>

// -- Server → Client: subscribe (SSE / WebSocket) ---------------------------

export const SubscribeMessage = Schema.Union([
  Schema.TaggedStruct("EventsAppended", { events: Schema.Array(SyncEvent) }),
  Schema.TaggedStruct("Heartbeat", { at: Schema.Number }),
])
export type SubscribeMessage = Schema.Schema.Type<typeof SubscribeMessage>

// -- Export file (local backup, same shape as a push snapshot) ---------------

export const EXPORT_VERSION = 1 as const

export const ExportFile = Schema.Struct({
  version: Schema.Literal(EXPORT_VERSION),
  exportedAt: Schema.Number,
  deviceId: DeviceId,
  events: Schema.Array(SyncEvent),
})
export type ExportFile = Schema.Schema.Type<typeof ExportFile>
