import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AccountId, CategoryId, CurrencyCode, DeviceId } from "@worth/domain"
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

  it("NotFound on categorizing a missing transaction", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* TransactionService
        yield* svc.categorize({
          id: "00000000-0000-0000-0000-000000000000" as never,
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
