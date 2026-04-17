import { Context, Effect, Layer } from "effect"
import type { DeviceId, Hlc } from "@worth/domain"
import * as HLC from "./hlc"

export interface HlcClockShape {
  readonly deviceId: DeviceId
  readonly next: Effect.Effect<Hlc>
  readonly observe: (remote: Hlc) => Effect.Effect<void>
}

/**
 * Provides the device id and next-HLC generator used when appending events.
 * v1 stores HLC state in memory only; sync (M3+) will persist across runs.
 */
export class HlcClock extends Context.Service<HlcClock, HlcClockShape>()(
  "@worth/sync/HlcClock",
) {}

export interface HlcClockConfig {
  readonly deviceId: DeviceId
  readonly initialHlc?: Hlc | undefined
  readonly now?: () => number
}

/** Build a concrete HlcClock service implementation without the Layer wrapper. */
export const makeHlcClock = (config: HlcClockConfig): HlcClockShape => {
  const now = config.now ?? (() => Date.now())
  let current: HLC.HlcParts | null =
    config.initialHlc !== undefined ? HLC.parse(config.initialHlc) : null

  const next = Effect.sync(() => {
    const hlc = HLC.tick(now(), current, config.deviceId)
    current = HLC.parse(hlc)
    return hlc
  })

  const observe = (remote: Hlc): Effect.Effect<void> =>
    Effect.sync(() => {
      const parts = HLC.parse(remote)
      const hlc = HLC.recv(now(), parts, current, config.deviceId)
      current = HLC.parse(hlc)
    })

  return { deviceId: config.deviceId, next, observe }
}

export const HlcClockLive = (config: HlcClockConfig): Layer.Layer<HlcClock> =>
  Layer.sync(HlcClock, () => makeHlcClock(config))
