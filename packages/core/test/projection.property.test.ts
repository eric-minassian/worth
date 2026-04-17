import fc from "fast-check"
import { Effect, Layer, ManagedRuntime } from "effect"
import { asc } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { DbConfigLive, DbLive, Db, schema } from "@worth/db"
import type { AccountType, CurrencyCode, DeviceId } from "@worth/domain"
import { HlcClockLive } from "@worth/sync"
import {
  AccountService,
  AccountServiceLive,
  CategoryService,
  CategoryServiceLive,
  EventLogLive,
  ImportServiceLive,
  SystemService,
  SystemServiceLive,
  TransactionService,
  TransactionServiceLive,
} from "../src"

const USD = "USD" as CurrencyCode
const device = "test-device" as DeviceId

const makeRuntime = () => {
  const dbStack = DbLive.pipe(Layer.provide(DbConfigLive(":memory:", "test-password")))
  const clockStack = HlcClockLive({ deviceId: device })
  const eventLog = EventLogLive.pipe(Layer.provide(Layer.merge(dbStack, clockStack)))
  const base = Layer.mergeAll(dbStack, clockStack, eventLog)
  const appLayer = Layer.mergeAll(
    base,
    AccountServiceLive.pipe(Layer.provide(base)),
    CategoryServiceLive.pipe(Layer.provide(base)),
    ImportServiceLive.pipe(Layer.provide(base)),
    SystemServiceLive.pipe(Layer.provide(base)),
    TransactionServiceLive.pipe(Layer.provide(base)),
  )
  return ManagedRuntime.make(appLayer)
}

// -- Command generator ------------------------------------------------------

type Cmd =
  | { readonly tag: "account"; readonly name: string; readonly type: AccountType }
  | { readonly tag: "category"; readonly name: string }
  | {
      readonly tag: "txn"
      readonly accountSlot: number
      readonly amount: number
      readonly payee: string
    }
  | { readonly tag: "categorize"; readonly txnSlot: number; readonly categorySlot: number }
  | { readonly tag: "deleteTxn"; readonly txnSlot: number }

const accountTypes: AccountType[] = ["checking", "savings", "credit", "cash", "other"]

const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({
    tag: fc.constant("account" as const),
    name: fc.string({ minLength: 1, maxLength: 20 }),
    type: fc.constantFrom(...accountTypes),
  }),
  fc.record({
    tag: fc.constant("category" as const),
    name: fc.string({ minLength: 1, maxLength: 20 }),
  }),
  fc.record({
    tag: fc.constant("txn" as const),
    accountSlot: fc.integer({ min: 0, max: 4 }),
    amount: fc.integer({ min: -10_000, max: 10_000 }),
    payee: fc.string({ minLength: 1, maxLength: 20 }),
  }),
  fc.record({
    tag: fc.constant("categorize" as const),
    txnSlot: fc.integer({ min: 0, max: 4 }),
    categorySlot: fc.integer({ min: 0, max: 4 }),
  }),
  fc.record({
    tag: fc.constant("deleteTxn" as const),
    txnSlot: fc.integer({ min: 0, max: 4 }),
  }),
)

// -- Command runner ---------------------------------------------------------

const applyCommands = (cmds: readonly Cmd[]) =>
  Effect.gen(function* () {
    const accountSvc = yield* AccountService
    const categorySvc = yield* CategoryService
    const txnSvc = yield* TransactionService

    const accountIds: string[] = []
    const categoryIds: string[] = []
    const txnIds: string[] = []

    for (const cmd of cmds) {
      switch (cmd.tag) {
        case "account": {
          const a = yield* accountSvc.create({
            name: cmd.name.trim() || "Unnamed",
            type: cmd.type,
            currency: USD,
          })
          accountIds.push(a.id)
          break
        }
        case "category": {
          const c = yield* categorySvc.create({
            name: cmd.name.trim() || "Unnamed",
            parentId: null,
            color: null,
          })
          categoryIds.push(c.id)
          break
        }
        case "txn": {
          if (accountIds.length === 0) break
          const accountId = accountIds[cmd.accountSlot % accountIds.length]
          if (!accountId) break
          const t = yield* txnSvc.create({
            accountId: accountId as never,
            postedAt: 1_700_000_000_000 + txnIds.length * 1000,
            amount: { minor: BigInt(cmd.amount), currency: USD },
            payee: cmd.payee.trim() || "Unnamed",
            memo: null,
          })
          txnIds.push(t.id)
          break
        }
        case "categorize": {
          if (txnIds.length === 0 || categoryIds.length === 0) break
          const txnId = txnIds[cmd.txnSlot % txnIds.length]
          const categoryId = categoryIds[cmd.categorySlot % categoryIds.length]
          if (!txnId || !categoryId) break
          yield* txnSvc.categorize({ id: txnId as never, categoryId: categoryId as never })
          break
        }
        case "deleteTxn": {
          if (txnIds.length === 0) break
          const txnId = txnIds[cmd.txnSlot % txnIds.length]
          if (!txnId) break
          yield* txnSvc.delete(txnId as never)
          txnIds.splice(cmd.txnSlot % txnIds.length, 1)
          break
        }
      }
    }
  })

// -- Projection snapshot ----------------------------------------------------

interface Snapshot {
  readonly accounts: readonly unknown[]
  readonly categories: readonly unknown[]
  readonly transactions: readonly unknown[]
}

const snapshot = (): Effect.Effect<Snapshot, never, Db> =>
  Effect.gen(function* () {
    const db = yield* Db
    return {
      accounts: db.drizzle
        .select()
        .from(schema.accounts)
        .orderBy(asc(schema.accounts.id))
        .all(),
      categories: db.drizzle
        .select()
        .from(schema.categories)
        .orderBy(asc(schema.categories.id))
        .all(),
      transactions: db.drizzle
        .select()
        .from(schema.transactions)
        .orderBy(asc(schema.transactions.id))
        .all(),
    }
  })

// -- Properties -------------------------------------------------------------

describe("projection invariants (property)", () => {
  it("rebuildProjections reproduces live projection state", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 0, maxLength: 15 }), async (cmds) => {
        const runtime = makeRuntime()
        try {
          await runtime.runPromise(applyCommands(cmds))
          const before = await runtime.runPromise(snapshot())
          await runtime.runPromise(
            Effect.gen(function* () {
              const sys = yield* SystemService
              yield* sys.rebuildProjections
            }),
          )
          const after = await runtime.runPromise(snapshot())
          expect(after).toEqual(before)
        } finally {
          await runtime.dispose()
        }
      }),
      { numRuns: 15 },
    )
  })

  it("export → fresh ingest reproduces the same projection state", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 0, maxLength: 15 }), async (cmds) => {
        const source = makeRuntime()
        const target = makeRuntime()
        try {
          await source.runPromise(applyCommands(cmds))
          const original = await source.runPromise(snapshot())
          const file = await source.runPromise(
            Effect.gen(function* () {
              const sys = yield* SystemService
              return yield* sys.exportLog
            }),
          )
          await target.runPromise(
            Effect.gen(function* () {
              const sys = yield* SystemService
              yield* sys.importLog(file)
            }),
          )
          const replayed = await target.runPromise(snapshot())
          expect(replayed).toEqual(original)
        } finally {
          await source.dispose()
          await target.dispose()
        }
      }),
      { numRuns: 10 },
    )
  })

  it("ingesting the same export twice is idempotent", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 0, maxLength: 10 }), async (cmds) => {
        const source = makeRuntime()
        const target = makeRuntime()
        try {
          await source.runPromise(applyCommands(cmds))
          const file = await source.runPromise(
            Effect.gen(function* () {
              const sys = yield* SystemService
              return yield* sys.exportLog
            }),
          )
          const first = await target.runPromise(
            Effect.gen(function* () {
              const sys = yield* SystemService
              return yield* sys.importLog(file)
            }),
          )
          const snapshotA = await target.runPromise(snapshot())
          const second = await target.runPromise(
            Effect.gen(function* () {
              const sys = yield* SystemService
              return yield* sys.importLog(file)
            }),
          )
          const snapshotB = await target.runPromise(snapshot())
          expect(second.accepted).toBe(0)
          expect(second.skipped).toBe(first.accepted)
          expect(snapshotA).toEqual(snapshotB)
        } finally {
          await source.dispose()
          await target.dispose()
        }
      }),
      { numRuns: 10 },
    )
  })
})
