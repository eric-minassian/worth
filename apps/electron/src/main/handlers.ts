import { Effect } from "effect"
import {
  AccountService,
  CategoryService,
  ImportService,
  TransactionService,
} from "@worth/core"
import type { CommandKind, InputOf, OutputOf } from "@worth/ipc"

/**
 * Maps each command kind to an effect that produces its output from its input.
 * The effect's requirements are satisfied by the app runtime's Layer.
 */
export type CommandHandler<K extends CommandKind> = (
  input: InputOf<K>,
) => Effect.Effect<
  OutputOf<K>,
  unknown,
  AccountService | CategoryService | ImportService | TransactionService
>

export type Handlers = { readonly [K in CommandKind]: CommandHandler<K> }

export const handlers: Handlers = {
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
}
