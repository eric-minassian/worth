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

const SAMPLE_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>026009593
<ACCTID>1234567890
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115000000
<TRNAMT>-12.50
<FITID>F-1
<NAME>WHOLE FOODS
<MEMO>groceries
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240117000000
<TRNAMT>2500.00
<FITID>F-2
<NAME>PAYROLL
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

const EXTERNAL_KEY = "ofx:026009593:1234567890"

describe("ImportService — OFX", () => {
  const createAccount = () =>
    Effect.gen(function* () {
      const svc = yield* AccountService
      return yield* svc.create({ name: "BofA Checking", type: "checking", currency: USD })
    })

  it("ofxPreview returns statements with external key and transaction count", async () => {
    const preview = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.ofxPreview({ text: SAMPLE_OFX })
      }),
    )
    expect(preview.statements).toHaveLength(1)
    const s = preview.statements[0]
    expect(s?.externalKey).toBe(EXTERNAL_KEY)
    expect(s?.transactionCount).toBe(2)
    expect(s?.accountIdHint).toBe("••••7890")
    expect(s?.matchedAccountId).toBeNull()
    expect(preview.investmentStatementCount).toBe(0)
  })

  it("ofxCommit creates transactions and reports per-statement counts", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const svc = yield* ImportService
        return yield* svc.ofxCommit({
          text: SAMPLE_OFX,
          assignments: [
            { externalKey: EXTERNAL_KEY, accountId: account.id, linkAccount: false },
          ],
        })
      }),
    )
    expect(result.perStatement).toHaveLength(1)
    expect(result.perStatement[0]?.imported).toBe(2)
    expect(result.perStatement[0]?.duplicates).toBe(0)
  })

  it("ofxCommit dedups on re-import by FITID", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const svc = yield* ImportService
        yield* svc.ofxCommit({
          text: SAMPLE_OFX,
          assignments: [
            { externalKey: EXTERNAL_KEY, accountId: account.id, linkAccount: false },
          ],
        })
        return yield* svc.ofxCommit({
          text: SAMPLE_OFX,
          assignments: [
            { externalKey: EXTERNAL_KEY, accountId: account.id, linkAccount: false },
          ],
        })
      }),
    )
    expect(result.perStatement[0]?.imported).toBe(0)
    expect(result.perStatement[0]?.duplicates).toBe(2)
  })

  it("linkAccount=true makes the next preview auto-route the statement", async () => {
    const matched = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const svc = yield* ImportService
        yield* svc.ofxCommit({
          text: SAMPLE_OFX,
          assignments: [
            { externalKey: EXTERNAL_KEY, accountId: account.id, linkAccount: true },
          ],
        })
        const preview = yield* svc.ofxPreview({ text: SAMPLE_OFX })
        return preview.statements[0]?.matchedAccountId
      }),
    )
    expect(matched).not.toBeNull()
  })

  it("importing an investment-only file warns and imports nothing", async () => {
    const investOnly = SAMPLE_OFX.replace(
      /<BANKMSGSRSV1>[\s\S]*<\/BANKMSGSRSV1>/,
      `<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>`,
    )
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.ofxCommit({ text: investOnly, assignments: [] })
      }),
    )
    expect(result.perStatement).toHaveLength(0)
    expect(result.investmentStatementCount).toBe(1)
  })

  it("ofxCommit dedups against transactions previously imported via CSV on the same day/amount", async () => {
    // Sample CSV + OFX each contain a 2024-01-15 -12.50 WHOLE FOODS entry.
    // Without the content fingerprint, the CSV hash and OFX FITID hash can't
    // collide, so the OFX import would re-create every CSV-imported row.
    const csv = [
      "Date,Description,Amount,Notes",
      "2024-01-15,Whole Foods,-12.50,groceries",
      "2024-01-17,Payroll,2500.00,",
    ].join("\n")
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const svc = yield* ImportService
        yield* svc.commit({ accountId: account.id, text: csv, mapping: sampleMapping })
        return yield* svc.ofxCommit({
          text: SAMPLE_OFX,
          assignments: [
            { externalKey: EXTERNAL_KEY, accountId: account.id, linkAccount: false },
          ],
        })
      }),
    )
    expect(result.perStatement[0]?.imported).toBe(0)
    expect(result.perStatement[0]?.duplicates).toBe(2)
  })

  it("csv commit dedups against transactions previously imported via OFX", async () => {
    const csv = [
      "Date,Description,Amount,Notes",
      "2024-01-15,Whole Foods,-12.50,groceries",
      "2024-01-17,Payroll,2500.00,",
    ].join("\n")
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createAccount()
        const svc = yield* ImportService
        yield* svc.ofxCommit({
          text: SAMPLE_OFX,
          assignments: [
            { externalKey: EXTERNAL_KEY, accountId: account.id, linkAccount: false },
          ],
        })
        return yield* svc.commit({ accountId: account.id, text: csv, mapping: sampleMapping })
      }),
    )
    expect(result.imported).toBe(0)
    expect(result.duplicates).toBe(2)
  })

  it("ofxCommit fails with NotFound when assigned account does not exist", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.ofxCommit({
          text: SAMPLE_OFX,
          assignments: [
            {
              externalKey: EXTERNAL_KEY,
              accountId: "00000000-0000-0000-0000-000000000000" as AccountId,
              linkAccount: false,
            },
          ],
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})
