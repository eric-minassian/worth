import type { DeviceId, Hlc } from "@worth/domain"

/**
 * Hybrid Logical Clock in the format `<physicalMs:13>.<counter:5>.<deviceId>`.
 *
 * - The physical ms and counter are zero-padded so that lexicographic string
 *   comparison matches the intended monotonic ordering.
 * - The device id tail breaks ties deterministically across devices.
 */

const MS_WIDTH = 13
const COUNTER_WIDTH = 5
const MAX_DRIFT_MS = 60_000

export interface HlcParts {
  readonly ms: number
  readonly counter: number
  readonly deviceId: DeviceId
}

export const format = ({ ms, counter, deviceId }: HlcParts): Hlc => {
  if (counter > 99_999) {
    throw new Error(`HLC counter overflow: ${counter}`)
  }
  return `${ms.toString().padStart(MS_WIDTH, "0")}.${counter
    .toString()
    .padStart(COUNTER_WIDTH, "0")}.${deviceId}` as Hlc
}

export const parse = (hlc: Hlc): HlcParts => {
  const parts = hlc.split(".")
  if (parts.length < 3) {
    throw new Error(`Invalid HLC: ${hlc}`)
  }
  const [msStr, counterStr, ...deviceParts] = parts as [string, string, ...string[]]
  const ms = Number.parseInt(msStr, 10)
  const counter = Number.parseInt(counterStr, 10)
  if (!Number.isFinite(ms) || !Number.isFinite(counter)) {
    throw new Error(`Invalid HLC: ${hlc}`)
  }
  return { ms, counter, deviceId: deviceParts.join(".") as DeviceId }
}

/**
 * Generate a new HLC for a locally-originated event.
 * `now` is the current wall-clock ms; `prev` is the last HLC this device saw.
 */
export const tick = (now: number, prev: HlcParts | null, deviceId: DeviceId): Hlc => {
  if (prev === null || now > prev.ms) {
    return format({ ms: now, counter: 0, deviceId })
  }
  return format({ ms: prev.ms, counter: prev.counter + 1, deviceId })
}

/**
 * Incorporate a remote HLC into the local clock and return a new HLC suitable
 * for a locally-originated event that happens after having observed `remote`.
 */
export const recv = (
  now: number,
  remote: HlcParts,
  prev: HlcParts | null,
  deviceId: DeviceId,
): Hlc => {
  const localMs = prev?.ms ?? 0
  const localCounter = prev?.counter ?? 0
  const maxMs = Math.max(now, localMs, remote.ms)

  if (Math.abs(remote.ms - now) > MAX_DRIFT_MS) {
    throw new Error(
      `Remote HLC drift exceeds ${MAX_DRIFT_MS}ms (remote=${remote.ms}, now=${now})`,
    )
  }

  const sameAsLocal = maxMs === localMs
  const sameAsRemote = maxMs === remote.ms

  let counter: number
  if (sameAsLocal && sameAsRemote) counter = Math.max(localCounter, remote.counter) + 1
  else if (sameAsLocal) counter = localCounter + 1
  else if (sameAsRemote) counter = remote.counter + 1
  else counter = 0

  return format({ ms: maxMs, counter, deviceId })
}

/** Lexicographic compare; matches canonical HLC ordering because the string is padded. */
export const compare = (a: Hlc, b: Hlc): number => (a < b ? -1 : a > b ? 1 : 0)
