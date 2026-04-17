import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AccountId, CurrencyCode, DeviceId } from "@worth/domain"
import { DbConfigLive, DbLive } from "@worth/db"
import { HlcClockLive } from "@worth/sync"
import {
  AccountService,
  AccountServiceLive,
  CategoryServiceLive,
  EventLogLive,
  ImportService,
  ImportServiceLive,
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
    ImportServiceLive.pipe(Layer.provide(base)),
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

const SAMPLE_CSV = [
  "Date,Description,Amount,Notes",
  "2024-01-15,Whole Foods,-54.32,groceries",
  "2024-01-16,Starbucks,-4.95,",
  "2024-01-17,Paycheck,2500.00,",
].join("\n")

const sampleMapping: Record<string, "date" | "payee" | "amount" | "memo" | "skip"> = {
  "0": "date",
  "1": "payee",
  "2": "amount",
  "3": "memo",
}

describe("ImportService", () => {
  const createAccount = () =>
    Effect.gen(function* () {
      const accountSvc = yield* AccountService
      return yield* accountSvc.create({
        name: "Checking",
        type: "checking",
        currency: USD,
      })
    })

  it("preview returns headers, sample rows, and suggested mapping", async () => {
    const preview = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.preview({ text: SAMPLE_CSV })
      }),
    )
    expect(preview.headers).toEqual(["Date", "Description", "Amount", "Notes"])
    expect(preview.totalRows).toBe(3)
    expect(preview.sampleRows).toHaveLength(3)
    expect(preview.suggestedMapping).toMatchObject({ "0": "date", "1": "payee", "2": "amount" })
  })

  it("commits new rows and reports counts", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const svc = yield* ImportService
        return yield* svc.commit({
          accountId: account.id,
          text: SAMPLE_CSV,
          mapping: sampleMapping,
        })
      }),
    )
    expect(result.total).toBe(3)
    expect(result.imported).toBe(3)
    expect(result.duplicates).toBe(0)
    expect(result.errors).toEqual([])
  })

  it("dedups identical rows on a second import of the same file", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const svc = yield* ImportService
        yield* svc.commit({
          accountId: account.id,
          text: SAMPLE_CSV,
          mapping: sampleMapping,
        })
        return yield* svc.commit({
          accountId: account.id,
          text: SAMPLE_CSV,
          mapping: sampleMapping,
        })
      }),
    )
    expect(result.imported).toBe(0)
    expect(result.duplicates).toBe(3)
  })

  it("imported transactions appear in TransactionService.list", async () => {
    const listed = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const importSvc = yield* ImportService
        const txnSvc = yield* TransactionService
        yield* importSvc.commit({
          accountId: account.id,
          text: SAMPLE_CSV,
          mapping: sampleMapping,
        })
        return yield* txnSvc.list({ accountId: account.id })
      }),
    )
    expect(listed).toHaveLength(3)
    expect(listed.map((t) => t.payee).toSorted()).toEqual(["Paycheck", "Starbucks", "Whole Foods"])
  })

  it("fails with NotFound when account does not exist", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.commit({
          accountId: "00000000-0000-0000-0000-000000000000" as AccountId,
          text: SAMPLE_CSV,
          mapping: sampleMapping,
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})
