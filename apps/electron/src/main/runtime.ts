import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  AccountServiceLive,
  CategoryServiceLive,
  EventLogLive,
  ImportServiceLive,
  TransactionServiceLive,
} from "@worth/core"
import { Db, DbConfigLive, DbLive, schema } from "@worth/db"
import type { DeviceId, Hlc } from "@worth/domain"
import { HlcClock, makeHlcClock, newDeviceId } from "@worth/sync"

const DEVICE_ID_KEY = "device_id"

/**
 * HLC clock layer bootstrapped from the meta table. On first launch, generates
 * and persists a fresh device id; on subsequent launches, reuses it.
 */
const HlcClockFromDb = Layer.effect(HlcClock)(
  Effect.gen(function* () {
    const db = yield* Db
    const row = db.drizzle
      .select()
      .from(schema.meta)
      .where(eq(schema.meta.key, DEVICE_ID_KEY))
      .get()

    let deviceId: DeviceId
    if (row) {
      deviceId = row.value as DeviceId
    } else {
      deviceId = newDeviceId()
      db.drizzle.insert(schema.meta).values({ key: DEVICE_ID_KEY, value: deviceId }).run()
    }

    const initialHlc = undefined as Hlc | undefined
    return makeHlcClock({ deviceId, initialHlc })
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
    TransactionServiceLive.pipe(Layer.provide(base)),
  )
}

export type AppRuntime = ManagedRuntime.ManagedRuntime<
  ReturnType<typeof makeAppLayer> extends Layer.Layer<infer A> ? A : never,
  never
>

export const createAppRuntime = (dbFilename: string): AppRuntime =>
  ManagedRuntime.make(makeAppLayer(dbFilename))
