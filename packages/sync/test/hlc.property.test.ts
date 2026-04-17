import fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { DeviceId, Hlc } from "@worth/domain"
import { HLC } from "../src"

const device = "d" as DeviceId

describe("HLC invariants (property)", () => {
  it("tick is strictly monotonic across any sequence of non-decreasing wall-clock reads", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 200 }),
        (deltas) => {
          let now = 1_000_000
          let prev: HLC.HlcParts | null = null
          const hlcs: Hlc[] = []
          for (const delta of deltas) {
            now += delta
            const hlc = HLC.tick(now, prev, device)
            hlcs.push(hlc)
            prev = HLC.parse(hlc)
          }
          for (let i = 1; i < hlcs.length; i++) {
            expect(HLC.compare(hlcs[i - 1] as Hlc, hlcs[i] as Hlc)).toBeLessThan(0)
          }
        },
      ),
    )
  })

  it("recv produces an HLC greater than both local and remote", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 30_000 }),
        fc.integer({ min: 0, max: 30_000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (base, localOffset, remoteOffset, localCounter, remoteCounter) => {
          const localHlc = HLC.format({
            ms: base,
            counter: localCounter,
            deviceId: device,
          })
          const remoteHlc = HLC.format({
            ms: base + remoteOffset - localOffset,
            counter: remoteCounter,
            deviceId: "r" as DeviceId,
          })
          const now = base + Math.max(localOffset, remoteOffset)
          const result = HLC.recv(now, HLC.parse(remoteHlc), HLC.parse(localHlc), device)
          expect(HLC.compare(localHlc, result)).toBeLessThan(0)
          expect(HLC.compare(remoteHlc, result)).toBeLessThan(0)
        },
      ),
    )
  })

  it("string comparison matches numeric (ms, counter) ordering", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_999_999_999_999 }),
        fc.integer({ min: 0, max: 99_999 }),
        fc.integer({ min: 0, max: 9_999_999_999_999 }),
        fc.integer({ min: 0, max: 99_999 }),
        (msA, counterA, msB, counterB) => {
          const a = HLC.format({ ms: msA, counter: counterA, deviceId: device })
          const b = HLC.format({ ms: msB, counter: counterB, deviceId: device })
          const numericCompare =
            msA !== msB ? Math.sign(msA - msB) : Math.sign(counterA - counterB)
          expect(Math.sign(HLC.compare(a, b))).toBe(numericCompare)
        },
      ),
    )
  })
})
