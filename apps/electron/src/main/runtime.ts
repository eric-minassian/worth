import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  AccountServiceLive,
  CategoryServiceLive,
  EventLogLive,
  ImportServiceLive,
  SystemServiceLive,
  TransactionServiceLive,
} from "@worth/core"
import { Db, DbConfigLive, DbLive, schema } from "@worth/db"
import type { DeviceId, Hlc } from "@worth/domain"
import { HlcClock, makeHlcClock, newDeviceId } from "@worth/sync"

const DEVICE_ID_KEY = "device_id"
const LAST_HLC_KEY = "last_hlc"

/**
 * HLC clock layer bootstrapped from the meta table. On first launch, generates
 * and persists a fresh device id; on subsequent launches, reuses it. Every
 * advance is persisted so the clock's monotonicity survives restarts.
 */
const HlcClockFromDb = Layer.effect(HlcClock)(
  Effect.gen(function* () {
    const db = yield* Db

    const read = (key: string): string | null =>
      db.drizzle.select().from(schema.meta).where(eq(schema.meta.key, key)).get()?.value ?? null

    const upsert = (key: string, value: string): void => {
      db.drizzle
        .insert(schema.meta)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.meta.key, set: { value } })
        .run()
    }

    let deviceId = read(DEVICE_ID_KEY) as DeviceId | null
    if (!deviceId) {
      deviceId = newDeviceId()
      upsert(DEVICE_ID_KEY, deviceId)
    }

    const initialHlc = (read(LAST_HLC_KEY) ?? undefined) as Hlc | undefined

    return makeHlcClock({
      deviceId,
      initialHlc,
      onAdvance: (hlc) => upsert(LAST_HLC_KEY, hlc),
    })
  }),
)

export const makeAppLayer = (dbFilename: string) => {
  const dbStack = DbLive.pipe(Layer.provide(DbConfigLive(dbFilename)))
  const clockStack = HlcClockFromDb.pipe(Layer.provide(dbStack))
  const eventLog = EventLogLive.pipe(Layer.provide(Layer.merge(dbStack, clockStack)))
  const base = Layer.mergeAll(dbStack, clockStack, eventLog)
  return Layer.mergeAll(
    base,
    AccountServiceLive.pipe(Layer.provide(base)),
    CategoryServiceLive.pipe(Layer.provide(base)),
    ImportServiceLive.pipe(Layer.provide(base)),
    SystemServiceLive.pipe(Layer.provide(base)),
    TransactionServiceLive.pipe(Layer.provide(base)),
  )
}

export type AppRuntime = ManagedRuntime.ManagedRuntime<
  ReturnType<typeof makeAppLayer> extends Layer.Layer<infer A> ? A : never,
  never
>

export const createAppRuntime = (dbFilename: string): AppRuntime =>
  ManagedRuntime.make(makeAppLayer(dbFilename))
