import { existsSync } from "node:fs"
import { Cause, Effect, Exit } from "effect"
import { Db, DbUnlockError } from "@worth/db"
import { createAppRuntime, type AppRuntime } from "./runtime"

type UnlockSuccess = { ok: true }
type UnlockFailure = { ok: false; reason: "wrong-password" | "corrupt" }
export type UnlockResult = UnlockSuccess | UnlockFailure

export interface VaultController {
  readonly dbPath: string
  readonly isInitialized: () => boolean
  readonly isUnlocked: () => boolean
  readonly getRuntime: () => AppRuntime | null
  readonly unlock: (password: string) => Promise<UnlockResult>
  readonly lock: () => Promise<void>
}

/**
 * Owns the encrypted-DB runtime lifecycle. The runtime only exists between
 * `unlock()` and `lock()` — every other RPC command is rejected as "Locked".
 */
export const makeVaultController = (dbPath: string): VaultController => {
  let runtime: AppRuntime | null = null

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
        return { ok: false, reason: err.value.reason }
      }
      return { ok: false, reason: "corrupt" }
    }
    runtime = candidate
    return { ok: true }
  }

  const lock = async (): Promise<void> => {
    if (!runtime) return
    const r = runtime
    runtime = null
    await r.dispose()
  }

  return {
    dbPath,
    isInitialized: () => existsSync(dbPath),
    isUnlocked: () => runtime !== null,
    getRuntime: () => runtime,
    unlock,
    lock,
  }
}
