import { existsSync } from "node:fs"
import { Cause, Effect, Exit } from "effect"
import { Db, DbUnlockError } from "@worth/db"
import { createAppRuntime, type AppRuntime } from "./runtime"
import {
  biometricAvailable,
  biometricEnabled,
  clearBiometricPassword,
  promptForBiometricPassword,
  storeBiometricPassword,
} from "./biometric"

type UnlockSuccess = { ok: true }
type UnlockFailure = { ok: false; reason: "wrong-password" | "corrupt" }
export type UnlockResult = UnlockSuccess | UnlockFailure

type BiometricUnlockReason =
  | UnlockFailure["reason"]
  | "user-cancelled"
  | "unavailable"
  | "not-enabled"

type BiometricUnlockResult =
  | { ok: true }
  | { ok: false; reason: BiometricUnlockReason }

type EnableBiometricResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "locked" }

export interface VaultController {
  readonly dbPath: string
  readonly isInitialized: () => boolean
  readonly isUnlocked: () => boolean
  readonly getRuntime: () => AppRuntime | null
  readonly unlock: (password: string) => Promise<UnlockResult>
  readonly lock: () => Promise<void>
  readonly biometricStatus: () => { available: boolean; enabled: boolean }
  readonly enableBiometric: () => Promise<EnableBiometricResult>
  readonly disableBiometric: () => Promise<{ ok: boolean }>
  readonly unlockBiometric: () => Promise<BiometricUnlockResult>
}

/**
 * Owns the encrypted-DB runtime lifecycle. The runtime only exists between
 * `unlock()` and `lock()` — every other RPC command is rejected as "Locked".
 *
 * The unlock password is cached in memory while the vault is open so biometric
 * enrollment can stash it via safeStorage without re-prompting the user.
 */
export const makeVaultController = (dbPath: string): VaultController => {
  let runtime: AppRuntime | null = null
  let currentPassword: string | null = null

  const unlock = async (password: string): Promise<UnlockResult> => {
    if (runtime) return { ok: true }
    const candidate = createAppRuntime(dbPath, password)
    // Force the Db layer to build by running an effect that requires it.
    // A wrong key surfaces here as a DbUnlockError inside the cause.
    const probe = Effect.gen(function* () {
      yield* Db
    })
    const exit = await candidate.runPromiseExit(probe)
    if (Exit.isFailure(exit)) {
      await candidate.dispose()
      const err = Cause.findErrorOption(exit.cause)
      if (err._tag === "Some" && err.value instanceof DbUnlockError) {
        // If biometric unlock produced a stale password, drop it so the next
        // launch falls back to a fresh password prompt.
        if (err.value.reason === "wrong-password" && biometricEnabled()) {
          await clearBiometricPassword().catch(() => {})
        }
        return { ok: false, reason: err.value.reason }
      }
      return { ok: false, reason: "corrupt" }
    }
    runtime = candidate
    currentPassword = password
    return { ok: true }
  }

  const lock = async (): Promise<void> => {
    if (!runtime) return
    const r = runtime
    runtime = null
    currentPassword = null
    await r.dispose()
  }

  const biometricStatus = (): { available: boolean; enabled: boolean } => ({
    available: biometricAvailable(),
    enabled: biometricEnabled(),
  })

  const enableBiometric = async (): Promise<EnableBiometricResult> => {
    if (!biometricAvailable()) return { ok: false, reason: "unavailable" }
    if (!currentPassword) return { ok: false, reason: "locked" }
    await storeBiometricPassword(currentPassword)
    return { ok: true }
  }

  const disableBiometric = async (): Promise<{ ok: boolean }> => {
    await clearBiometricPassword()
    return { ok: true }
  }

  const unlockBiometric = async (): Promise<BiometricUnlockResult> => {
    const prompt = await promptForBiometricPassword("unlock Worth")
    if (!prompt.ok) return { ok: false, reason: prompt.reason }
    const result = await unlock(prompt.password)
    if (result.ok) return { ok: true }
    return { ok: false, reason: result.reason }
  }

  return {
    dbPath,
    isInitialized: () => existsSync(dbPath),
    isUnlocked: () => runtime !== null,
    getRuntime: () => runtime,
    unlock,
    lock,
    biometricStatus,
    enableBiometric,
    disableBiometric,
    unlockBiometric,
  }
}
