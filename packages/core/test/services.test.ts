import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  AccountId,
  CategoryId,
  CurrencyCode,
  DeviceId,
  TransactionId,
} from "@worth/domain"
import { DbConfigLive, DbLive } from "@worth/db"
import { HlcClockLive } from "@worth/sync"
import {
  AccountService,
  AccountServiceLive,
  CategoryService,
  CategoryServiceLive,
  EventLog,
  EventLogLive,
  TransactionService,
  TransactionServiceLive,
} from "../src"

const USD = "USD" as CurrencyCode
const testDevice = "test-device" as DeviceId

const makeTestRuntime = () => {
  const dbStack = DbLive.pipe(Layer.provide(DbConfigLive(":memory:", "test-password")))
  const clockStack = HlcClockLive({ deviceId: testDevice })
  const eventLog = EventLogLive.pipe(Layer.provide(Layer.merge(dbStack, clockStack)))
  const base = Layer.mergeAll(dbStack, clockStack, eventLog)
  const appLayer = Layer.mergeAll(
    base,
    AccountServiceLive.pipe(Layer.provide(base)),
    CategoryServiceLive.pipe(Layer.provide(base)),
    TransactionServiceLive.pipe(Layer.provide(base)),
  )
  return ManagedRuntime.make(appLayer)
}

let runtime: ReturnType<typeof makeTestRuntime>

beforeEach(() => {
  runtime = makeTestRuntime()
})

afterEach(async () => {
  await runtime.dispose()
})

describe("AccountService", () => {
  it("creates an account and reflects it in list()", async () => {
    const account = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* AccountService
        return yield* svc.create({ name: "Chase Checking", type: "checking", currency: USD })
      }),
    )
    expect(account.name).toBe("Chase Checking")

    const accounts = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* AccountService
        return yield* svc.list
      }),
    )
    expect(accounts.map((a) => a.id)).toEqual([account.id])
  })

  it("archive marks archivedAt and leaves the row in place", async () => {
    const id = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* AccountService
        const a = yield* svc.create({ name: "Cash", type: "cash", currency: USD })
        yield* svc.archive(a.id)
        return a.id
      }),
    )
    const fetched = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* AccountService
        return yield* svc.get(id)
      }),
    )
    expect(fetched.archivedAt).not.toBeNull()
  })

  it("linkExternalKey + findByExternalKey round-trip", async () => {
    const found = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* AccountService
        const a = yield* svc.create({ name: "BofA", type: "checking", currency: USD })
        yield* svc.linkExternalKey({
          accountId: a.id,
          externalKey: "ofx:026009593:1234567890",
        })
        return yield* svc.findByExternalKey("ofx:026009593:1234567890")
      }),
    )
    expect(found?.name).toBe("BofA")
  })

  it("findByExternalKey returns null for unknown key", async () => {
    const found = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* AccountService
        return yield* svc.findByExternalKey("nope")
      }),
    )
    expect(found).toBeNull()
  })

  it("linkExternalKey fails with NotFound for missing account", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* AccountService
        return yield* svc.linkExternalKey({
          accountId: "00000000-0000-0000-0000-000000000000" as AccountId,
          externalKey: "ofx:whatever",
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("TransactionService", () => {
  const seedAccount = () =>
    Effect.gen(function* () {
      const svc = yield* AccountService
      return yield* svc.create({ name: "Test", type: "checking", currency: USD })
    })

  it("creates a transaction and includes it in list()", async () => {
    const { account, txn } = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* seedAccount()
        const svc = yield* TransactionService
        const txn = yield* svc.create({
          accountId: account.id,
          postedAt: 1_700_000_000_000,
          amount: { minor: -1250n, currency: USD },
          payee: "Whole Foods",
          memo: null,
        })
        return { account, txn }
      }),
    )

    const found = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* TransactionService
        return yield* svc.list({ accountId: account.id })
      }),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.id).toBe(txn.id)
    expect(found[0]?.amount.minor).toBe(-1250n)
  })

  it("categorize() attaches a category", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const categorySvc = yield* CategoryService
        const txnSvc = yield* TransactionService

        const account = yield* accountSvc.create({
          name: "Test",
          type: "checking",
          currency: USD,
        })
        const category = yield* categorySvc.create({
          name: "Groceries",
          parentId: null,
          color: null,
        })
        const txn = yield* txnSvc.create({
          accountId: account.id,
          postedAt: 1_700_000_000_000,
          amount: { minor: -500n, currency: USD },
          payee: "Safeway",
          memo: null,
        })
        yield* txnSvc.categorize({ id: txn.id, categoryId: category.id })
        const after = yield* txnSvc.list({ accountId: account.id })
        return { categoryId: category.id, after }
      }),
    )
    expect(result.after[0]?.categoryId).toBe(result.categoryId)
  })

  it("list filter by search matches payee", async () => {
    const rows = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const txnSvc = yield* TransactionService
        const account = yield* accountSvc.create({ name: "T", type: "checking", currency: USD })
        for (const payee of ["Alpha", "Beta", "Gamma Beta"]) {
          yield* txnSvc.create({
            accountId: account.id,
            postedAt: Date.now(),
            amount: { minor: -100n, currency: USD },
            payee,
            memo: null,
          })
        }
        return yield* txnSvc.list({ search: "Beta" })
      }),
    )
    expect(rows.map((r) => r.payee).toSorted()).toEqual(["Beta", "Gamma Beta"])
  })

  it("listDuplicateGroups finds rows sharing (account, postedAt, amount, currency)", async () => {
    const groups = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const txnSvc = yield* TransactionService
        const log = yield* EventLog
        const a = yield* accountSvc.create({ name: "A", type: "checking", currency: USD })

        // null importHash bypasses both dedup paths, letting us seed the
        // projection with rows the service API would otherwise reject.
        for (let i = 0; i < 3; i++) {
          yield* log.append({
            _tag: "TransactionImported",
            id: `00000000-0000-0000-0000-00000000000${i}` as TransactionId,
            accountId: a.id,
            postedAt: 1_700_000_000_000,
            amount: { minor: -500n, currency: USD },
            payee: `dup-${i}`,
            memo: null,
            importHash: null,
            at: Date.now(),
          })
        }
        // A singleton that shouldn't appear.
        yield* txnSvc.create({
          accountId: a.id,
          postedAt: 1_700_000_000_000,
          amount: { minor: -999n, currency: USD },
          payee: "singleton",
          memo: null,
        })
        return yield* txnSvc.listDuplicateGroups({})
      }),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.members).toHaveLength(3)
    expect(groups[0]?.amount.minor).toBe(-500n)
    expect(groups[0]?.members.map((m) => m.payee).toSorted()).toEqual([
      "dup-0",
      "dup-1",
      "dup-2",
    ])
  })

  it("listDuplicateGroups with windowDays clusters rows across adjacent days", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const txnSvc = yield* TransactionService
        const log = yield* EventLog
        const a = yield* accountSvc.create({ name: "A", type: "checking", currency: USD })

        const day = (n: number) => Date.UTC(2024, 0, 15) + n * 86_400_000
        for (let i = 0; i < 3; i++) {
          const d = [0, 2, 5][i] as number
          yield* log.append({
            _tag: "TransactionImported",
            id: `aaaaaaaa-0000-0000-0000-00000000000${i}` as TransactionId,
            accountId: a.id,
            postedAt: day(d),
            amount: { minor: -500n, currency: USD },
            payee: `fuzzy-${i}`,
            memo: null,
            importHash: null,
            at: Date.now(),
          })
        }

        const exact = yield* txnSvc.listDuplicateGroups({ windowDays: 0 })
        const window3 = yield* txnSvc.listDuplicateGroups({ windowDays: 3 })
        const window1 = yield* txnSvc.listDuplicateGroups({ windowDays: 1 })
        return { exact, window1, window3 }
      }),
    )
    expect(result.exact).toHaveLength(0) // no exact-date dupes
    expect(result.window1).toHaveLength(0) // gap of 2 breaks the chain
    expect(result.window3).toHaveLength(1) // gaps 2 and 3 both within window
    expect(result.window3[0]?.members).toHaveLength(3)
  })

  it("dismissDuplicateGroup hides a cluster until membership changes", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const txnSvc = yield* TransactionService
        const log = yield* EventLog
        const a = yield* accountSvc.create({ name: "A", type: "checking", currency: USD })

        const memberIds: readonly TransactionId[] = [
          "bbbbbbbb-0000-0000-0000-000000000001" as TransactionId,
          "bbbbbbbb-0000-0000-0000-000000000002" as TransactionId,
        ]
        for (const id of memberIds) {
          yield* log.append({
            _tag: "TransactionImported",
            id,
            accountId: a.id,
            postedAt: 1_700_000_000_000,
            amount: { minor: -100n, currency: USD },
            payee: "near-dup",
            memo: null,
            importHash: null,
            at: Date.now(),
          })
        }
        const before = yield* txnSvc.listDuplicateGroups({})
        yield* txnSvc.dismissDuplicateGroup(memberIds)
        const after = yield* txnSvc.listDuplicateGroups({})
        return { before, after }
      }),
    )
    expect(result.before).toHaveLength(1)
    expect(result.after).toHaveLength(0)
  })

  it("listDuplicateGroups can be filtered to a single account", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const txnSvc = yield* TransactionService
        const log = yield* EventLog
        const a = yield* accountSvc.create({ name: "A", type: "checking", currency: USD })
        const b = yield* accountSvc.create({ name: "B", type: "checking", currency: USD })

        const dup = (accountId: typeof a.id, idx: string) =>
          log.append({
            _tag: "TransactionImported",
            id: idx as TransactionId,
            accountId,
            postedAt: 1_700_000_000_000,
            amount: { minor: -100n, currency: USD },
            payee: "dup",
            memo: null,
            importHash: null,
            at: Date.now(),
          })
        yield* dup(a.id, "aaaaaaaa-0000-0000-0000-000000000001")
        yield* dup(a.id, "aaaaaaaa-0000-0000-0000-000000000002")
        yield* dup(b.id, "bbbbbbbb-0000-0000-0000-000000000001")
        yield* dup(b.id, "bbbbbbbb-0000-0000-0000-000000000002")

        const onlyA = yield* txnSvc.listDuplicateGroups({ accountId: a.id })
        const onlyB = yield* txnSvc.listDuplicateGroups({ accountId: b.id })
        const all = yield* txnSvc.listDuplicateGroups({})
        return { onlyA, onlyB, all }
      }),
    )
    expect(result.onlyA).toHaveLength(1)
    expect(result.onlyB).toHaveLength(1)
    expect(result.all).toHaveLength(2)
  })

  it("deleteMany removes every listed transaction and reports the count", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const txnSvc = yield* TransactionService
        const a = yield* accountSvc.create({ name: "A", type: "checking", currency: USD })
        const ids = []
        for (let i = 0; i < 3; i++) {
          const t = yield* txnSvc.create({
            accountId: a.id,
            postedAt: 1_700_000_000_000 + i,
            amount: { minor: BigInt(-100 * (i + 1)), currency: USD },
            payee: `p-${i}`,
            memo: null,
          })
          ids.push(t.id)
        }
        const outcome = yield* txnSvc.deleteMany(ids)
        const remaining = yield* txnSvc.list({ accountId: a.id })
        return { outcome, remaining }
      }),
    )
    expect(result.outcome.deleted).toBe(3)
    expect(result.remaining).toHaveLength(0)
  })

  it("deleteMany fails fast if any id is unknown without deleting anything", async () => {
    const outcome = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const txnSvc = yield* TransactionService
        const a = yield* accountSvc.create({ name: "A", type: "checking", currency: USD })
        const real = yield* txnSvc.create({
          accountId: a.id,
          postedAt: 1_700_000_000_000,
          amount: { minor: -100n, currency: USD },
          payee: "real",
          memo: null,
        })
        return yield* txnSvc.deleteMany([
          real.id,
          "00000000-0000-0000-0000-000000000000" as TransactionId,
        ])
      }),
    )
    expect(outcome._tag).toBe("Failure")
  })

  it("NotFound on categorizing a missing transaction", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* TransactionService
        yield* svc.categorize({
          id: "00000000-0000-0000-0000-000000000000" as TransactionId,
          categoryId: null,
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("EventLog", () => {
  it("appends an event per mutation and stores them in HLC order", async () => {
    const events = await runtime.runPromise(
      Effect.gen(function* () {
        const accountSvc = yield* AccountService
        const categorySvc = yield* CategoryService
        const log = yield* EventLog
        yield* accountSvc.create({ name: "A", type: "checking", currency: USD })
        yield* categorySvc.create({ name: "Food", parentId: null, color: null })
        return yield* log.list
      }),
    )
    expect(events.map((e) => e.event._tag)).toEqual(["AccountCreated", "CategoryCreated"])
    expect(events[0] && events[1] && events[0].hlc < events[1].hlc).toBe(true)
  })
})

describe("dummy to keep types", () => {
  it("AccountId and CategoryId are distinct brands", () => {
    const a: AccountId = "a" as AccountId
    const c: CategoryId = "c" as CategoryId
    expect(a).not.toBe(c)
  })
})
