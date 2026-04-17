import { readFile, writeFile } from "node:fs/promises"
import { dialog } from "electron"
import { Effect, Schema } from "effect"
import {
  AccountService,
  CategoryService,
  ImportService,
  SystemService,
  TransactionService,
} from "@worth/core"
import type { CommandKind, InputOf, OutputOf } from "@worth/ipc"
import { ExportFile } from "@worth/sync"
import { Updater } from "./updater"

/**
 * Maps each command kind to an effect that produces its output from its input.
 * The effect's requirements are satisfied by the app runtime's Layer.
 */
export type CommandHandler<K extends CommandKind> = (
  input: InputOf<K>,
) => Effect.Effect<
  OutputOf<K>,
  unknown,
  | AccountService
  | CategoryService
  | ImportService
  | SystemService
  | TransactionService
  | Updater
>

export type Handlers = { readonly [K in CommandKind]: CommandHandler<K> }

const decodeExport = Schema.decodeUnknownResult(ExportFile)

// vault.* commands are intercepted by the RPC handler before dispatch — these
// stubs exist only to satisfy the exhaustive Handlers map.
const unreachableVault = (): never => {
  throw new Error("vault.* commands must be handled outside the app runtime")
}

export const handlers: Handlers = {
  "vault.status": () => Effect.sync(unreachableVault),
  "vault.unlock": () => Effect.sync(unreachableVault),
  "vault.lock": () => Effect.sync(unreachableVault),

  ping: (input) =>
    Effect.sync(() => ({
      message: `pong: ${input.message}`,
      at: new Date().toISOString(),
    })),

  "account.create": (input) =>
    Effect.gen(function* () {
      const svc = yield* AccountService
      return yield* svc.create(input)
    }),

  "account.list": () =>
    Effect.gen(function* () {
      const svc = yield* AccountService
      return yield* svc.list
    }),

  "account.rename": (input) =>
    Effect.gen(function* () {
      const svc = yield* AccountService
      yield* svc.rename(input)
    }),

  "account.archive": (input) =>
    Effect.gen(function* () {
      const svc = yield* AccountService
      yield* svc.archive(input.id)
    }),

  "category.create": (input) =>
    Effect.gen(function* () {
      const svc = yield* CategoryService
      return yield* svc.create(input)
    }),

  "category.list": () =>
    Effect.gen(function* () {
      const svc = yield* CategoryService
      return yield* svc.list
    }),

  "transaction.create": (input) =>
    Effect.gen(function* () {
      const svc = yield* TransactionService
      return yield* svc.create(input)
    }),

  "transaction.list": (input) =>
    Effect.gen(function* () {
      const svc = yield* TransactionService
      return yield* svc.list(input)
    }),

  "transaction.categorize": (input) =>
    Effect.gen(function* () {
      const svc = yield* TransactionService
      yield* svc.categorize(input)
    }),

  "transaction.edit": (input) =>
    Effect.gen(function* () {
      const svc = yield* TransactionService
      yield* svc.edit(input)
    }),

  "transaction.delete": (input) =>
    Effect.gen(function* () {
      const svc = yield* TransactionService
      yield* svc.delete(input.id)
    }),

  "transaction.import.preview": (input) =>
    Effect.gen(function* () {
      const svc = yield* ImportService
      return yield* svc.preview(input)
    }),

  "transaction.import.commit": (input) =>
    Effect.gen(function* () {
      const svc = yield* ImportService
      return yield* svc.commit(input)
    }),

  "system.stats": () =>
    Effect.gen(function* () {
      const svc = yield* SystemService
      return yield* svc.stats
    }),

  "system.export": () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise(() =>
        dialog.showSaveDialog({
          title: "Export event log",
          defaultPath: `worth-events-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        }),
      )
      if (result.canceled || !result.filePath) {
        return { cancelled: true as const }
      }

      const svc = yield* SystemService
      const file = yield* svc.exportLog
      yield* Effect.tryPromise(() =>
        writeFile(result.filePath, JSON.stringify(file, null, 2), "utf8"),
      )

      return {
        cancelled: false as const,
        path: result.filePath,
        eventCount: file.events.length,
      }
    }),

  "system.import": () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise(() =>
        dialog.showOpenDialog({
          title: "Import event log",
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        }),
      )
      const filePath = result.filePaths[0]
      if (result.canceled || !filePath) {
        return { cancelled: true as const }
      }

      const text = yield* Effect.tryPromise(() => readFile(filePath, "utf8"))
      const parsed = JSON.parse(text) as unknown
      const decoded = decodeExport(parsed)
      if (decoded._tag === "Failure") {
        return yield* Effect.fail(
          new Error(`Not a valid Worth export file: ${decoded.failure.toString()}`),
        )
      }

      const svc = yield* SystemService
      const { accepted, skipped } = yield* svc.importLog(decoded.success)

      return { cancelled: false as const, path: filePath, accepted, skipped }
    }),

  "system.rebuildProjections": () =>
    Effect.gen(function* () {
      const svc = yield* SystemService
      return yield* svc.rebuildProjections
    }),

  "updater.getState": () =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return updater.getState()
    }),

  "updater.checkForUpdates": () =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* Effect.promise(() => updater.checkForUpdates())
    }),

  "updater.downloadUpdate": () =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* Effect.promise(() => updater.downloadUpdate())
    }),

  "updater.quitAndInstall": () =>
    Effect.gen(function* () {
      const updater = yield* Updater
      const ok = yield* Effect.promise(() => updater.quitAndInstall())
      return { ok }
    }),

  "updater.setChannel": (input) =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* Effect.promise(() => updater.setChannel(input.channel))
    }),

  "updater.openReleasePage": () =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return { ok: yield* Effect.promise(() => updater.openReleasePage()) }
    }),
}
