import { describe, expect, it } from "vitest"
import type { DeviceId, Hlc } from "@worth/domain"
import { HLC } from "../src"

const deviceA = "aaaa" as DeviceId
const deviceB = "bbbb" as DeviceId

describe("HLC.format / parse", () => {
  it("round-trips through parse", () => {
    const original = HLC.format({ ms: 1_700_000_000_000, counter: 7, deviceId: deviceA })
    const parsed = HLC.parse(original)
    expect(parsed).toEqual({ ms: 1_700_000_000_000, counter: 7, deviceId: deviceA })
  })

  it("is lexicographically ordered by (ms, counter, deviceId)", () => {
    const a = HLC.format({ ms: 1_700_000_000_000, counter: 0, deviceId: deviceA })
    const b = HLC.format({ ms: 1_700_000_000_001, counter: 0, deviceId: deviceA })
    const c = HLC.format({ ms: 1_700_000_000_001, counter: 1, deviceId: deviceA })
    expect([c, a, b].toSorted()).toEqual([a, b, c])
  })

  it("pads so that string order matches numeric order across decades", () => {
    const small = HLC.format({ ms: 1_000_000, counter: 0, deviceId: deviceA })
    const big = HLC.format({ ms: 9_999_999_999_999, counter: 0, deviceId: deviceA })
    expect(small < big).toBe(true)
  })

  it("rejects counter overflow", () => {
    expect(() =>
      HLC.format({ ms: 1, counter: 100_000, deviceId: deviceA }),
    ).toThrow(/counter overflow/)
  })
})

describe("HLC.tick", () => {
  it("starts at now with counter 0 when no prior state", () => {
    const hlc = HLC.tick(1_000, null, deviceA)
    expect(HLC.parse(hlc)).toEqual({ ms: 1_000, counter: 0, deviceId: deviceA })
  })

  it("resets counter when physical time moves forward", () => {
    const first = HLC.parse(HLC.tick(1_000, null, deviceA))
    const second = HLC.tick(2_000, first, deviceA)
    expect(HLC.parse(second)).toEqual({ ms: 2_000, counter: 0, deviceId: deviceA })
  })

  it("bumps counter when physical time stalls", () => {
    const first = HLC.parse(HLC.tick(1_000, null, deviceA))
    const second = HLC.parse(HLC.tick(1_000, first, deviceA))
    const third = HLC.parse(HLC.tick(1_000, second, deviceA))
    expect(second).toEqual({ ms: 1_000, counter: 1, deviceId: deviceA })
    expect(third).toEqual({ ms: 1_000, counter: 2, deviceId: deviceA })
  })

  it("uses the higher of physical-now and prior ms", () => {
    const first = HLC.parse(HLC.tick(5_000, null, deviceA))
    const second = HLC.tick(4_000, first, deviceA)
    expect(HLC.parse(second)).toEqual({ ms: 5_000, counter: 1, deviceId: deviceA })
  })
})

describe("HLC.recv", () => {
  const parse = HLC.parse

  it("advances past a remote clock ahead of us", () => {
    const remote = parse(HLC.format({ ms: 10_000, counter: 3, deviceId: deviceB }))
    const next = HLC.recv(5_000, remote, null, deviceA)
    expect(parse(next).ms).toBe(10_000)
    expect(parse(next).counter).toBe(4)
    expect(parse(next).deviceId).toBe(deviceA)
  })

  it("bumps max counter when local, remote and now all match", () => {
    const local = parse(HLC.format({ ms: 1_000, counter: 5, deviceId: deviceA }))
    const remote = parse(HLC.format({ ms: 1_000, counter: 2, deviceId: deviceB }))
    const next = parse(HLC.recv(1_000, remote, local, deviceA))
    expect(next).toEqual({ ms: 1_000, counter: 6, deviceId: deviceA })
  })

  it("rejects remote clocks beyond drift tolerance", () => {
    const tooFar = parse(HLC.format({ ms: 1_000_000_000_000, counter: 0, deviceId: deviceB }))
    expect(() => HLC.recv(1_000, tooFar, null, deviceA)).toThrow(/drift/)
  })
})

describe("HLC.compare", () => {
  it("orders consistently with lexicographic string compare", () => {
    const a: Hlc = HLC.format({ ms: 1, counter: 0, deviceId: deviceA })
    const b: Hlc = HLC.format({ ms: 1, counter: 1, deviceId: deviceA })
    expect(HLC.compare(a, b)).toBeLessThan(0)
    expect(HLC.compare(b, a)).toBeGreaterThan(0)
    expect(HLC.compare(a, a)).toBe(0)
  })
})
