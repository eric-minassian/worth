import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Exit, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Db, DbConfigLive, DbLive } from "../src"

describe("DbLive encryption", () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worth-enc-"))
    dbPath = join(dir, "worth.db")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const openWith = (password: string) =>
    Effect.gen(function* () {
      yield* Db
    }).pipe(Effect.provide(DbLive.pipe(Layer.provide(DbConfigLive(dbPath, password)))))

  it("accepts the correct password on reopen", async () => {
    await Effect.runPromise(openWith("hunter2"))
    await Effect.runPromise(openWith("hunter2"))
  })

  it("rejects a wrong password with a DbUnlockError tagged 'wrong-password'", async () => {
    await Effect.runPromise(openWith("first-password"))
    const exit = await Effect.runPromiseExit(openWith("second-password"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const text = JSON.stringify(exit.cause.toJSON())
      expect(text).toContain("DbUnlockError")
      expect(text).toContain("wrong-password")
    }
  })
})
