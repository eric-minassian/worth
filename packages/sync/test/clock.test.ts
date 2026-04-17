import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { DeviceId, Hlc } from "@worth/domain"
import { HLC, makeHlcClock } from "../src"

const deviceId = "device-test" as DeviceId

describe("HlcClock.next", () => {
  it("returns monotonically increasing HLCs", async () => {
    let t = 1_000
    const clock = makeHlcClock({ deviceId, now: () => t })
    const a = await Effect.runPromise(clock.next)
    const b = await Effect.runPromise(clock.next)
    t += 1
    const c = await Effect.runPromise(clock.next)
    expect(HLC.compare(a, b)).toBeLessThan(0)
    expect(HLC.compare(b, c)).toBeLessThan(0)
  })

  it("observe() then next() produces an HLC past the remote", async () => {
    const clock = makeHlcClock({ deviceId, now: () => 1_000 })
    const remote = HLC.format({ ms: 5_000, counter: 0, deviceId: "other" as DeviceId }) as Hlc
    await Effect.runPromise(clock.observe(remote))
    const next = await Effect.runPromise(clock.next)
    expect(HLC.parse(next).ms).toBe(5_000)
    expect(HLC.compare(remote, next)).toBeLessThan(0)
  })
})
