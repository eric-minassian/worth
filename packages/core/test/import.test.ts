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
  InstrumentService,
  InstrumentServiceLive,
  InvestmentAccountService,
  InvestmentAccountServiceLive,
  InvestmentTransactionService,
  InvestmentTransactionServiceLive,
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
    InstrumentServiceLive.pipe(Layer.provide(base)),
    InvestmentAccountServiceLive.pipe(Layer.provide(base)),
    InvestmentTransactionServiceLive.pipe(Layer.provide(base)),
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

  it("importing an investment-only file imports no bank transactions when no investment assignment is given", async () => {
    const investOnly = SAMPLE_OFX.replace(
      /<BANKMSGSRSV1>[\s\S]*<\/BANKMSGSRSV1>/,
      `<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS>` +
        `<CURDEF>USD<INVACCTFROM><BROKERID>fidelity.com<ACCTID>Z12345678</INVACCTFROM>` +
        `<INVTRANLIST></INVTRANLIST>` +
        `</INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>`,
    )
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.ofxCommit({
          text: investOnly,
          assignments: [],
          investmentAssignments: undefined,
        })
      }),
    )
    expect(result.perStatement).toHaveLength(0)
    expect(result.perInvestmentStatement).toHaveLength(0)
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

// -- Investment OFX import --------------------------------------------------

const SAMPLE_INV_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>0
<INVSTMTRS>
<CURDEF>USD
<INVACCTFROM>
<BROKERID>fidelity.com
<ACCTID>Z12345678
</INVACCTFROM>
<INVTRANLIST>
<BUYSTOCK>
<INVBUY>
<INVTRAN><FITID>BUY-1<DTTRADE>20240105000000</INVTRAN>
<SECID><UNIQUEID>922908363<UNIQUEIDTYPE>CUSIP</SECID>
<UNITS>10
<UNITPRICE>200.00
<COMMISSION>0
<FEES>0
<TOTAL>-2000.00
</INVBUY>
<BUYTYPE>BUY
</BUYSTOCK>
<INCOME>
<INVTRAN><FITID>DIV-1<DTTRADE>20240125000000</INVTRAN>
<SECID><UNIQUEID>922908363<UNIQUEIDTYPE>CUSIP</SECID>
<INCOMETYPE>DIV
<TOTAL>12.50
</INCOME>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1>
<SECLIST>
<STOCKINFO>
<SECINFO>
<SECID><UNIQUEID>922908363<UNIQUEIDTYPE>CUSIP</SECID>
<SECNAME>Vanguard Total Stock Market ETF
<TICKER>VTI
</SECINFO>
</STOCKINFO>
</SECLIST>
</SECLISTMSGSRSV1>
</OFX>`

const INV_EXTERNAL_KEY = "ofx-inv:fidelity.com:Z12345678"

describe("ImportService — investment OFX", () => {
  const createInvAccount = () =>
    Effect.gen(function* () {
      const svc = yield* InvestmentAccountService
      return yield* svc.create({
        name: "Fidelity Brokerage",
        institution: "Fidelity",
        currency: USD,
      })
    })

  it("preview surfaces investment statements with broker id and trade/div counts", async () => {
    const preview = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.ofxPreview({ text: SAMPLE_INV_OFX })
      }),
    )
    expect(preview.investmentStatements).toHaveLength(1)
    const s = preview.investmentStatements[0]
    expect(s?.externalKey).toBe(INV_EXTERNAL_KEY)
    expect(s?.tradeCount).toBe(1)
    expect(s?.dividendCount).toBe(1)
    expect(s?.securityCount).toBe(1)
    expect(s?.matchedInvestmentAccountId).toBeNull()
    expect(s?.sample[0]?.symbol).toBe("VTI")
  })

  it("commit creates the instrument, buys shares, and records the dividend", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const account = yield* createInvAccount()
        const svc = yield* ImportService
        const res = yield* svc.ofxCommit({
          text: SAMPLE_INV_OFX,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: INV_EXTERNAL_KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
        const holdings = yield* acctSvc.listHoldings(account.id)
        const instSvc = yield* InstrumentService
        const instruments = yield* instSvc.list
        return { res, holdings, instruments, accountId: account.id }
      }),
    )
    expect(result.res.perInvestmentStatement).toHaveLength(1)
    const statement = result.res.perInvestmentStatement[0]!
    expect(statement.imported).toBe(2)
    expect(statement.duplicates).toBe(0)
    expect(statement.instrumentsCreated).toBe(1)
    expect(result.instruments).toHaveLength(1)
    expect(result.instruments[0]?.symbol).toBe("VTI")
    // Holding: 10 shares × $200 = $2000 cost basis.
    expect(result.holdings).toHaveLength(1)
    expect(result.holdings[0]?.quantity).toBe(BigInt(10 * 1e8))
    expect(result.holdings[0]?.costBasis.minor).toBe(200_000n)
  })

  it("re-importing the same file is a no-op (deterministic ids dedupe)", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createInvAccount()
        const svc = yield* ImportService
        yield* svc.ofxCommit({
          text: SAMPLE_INV_OFX,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: INV_EXTERNAL_KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
        return yield* svc.ofxCommit({
          text: SAMPLE_INV_OFX,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: INV_EXTERNAL_KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
      }),
    )
    const statement = result.perInvestmentStatement[0]!
    expect(statement.imported).toBe(0)
    expect(statement.duplicates).toBe(2)
    expect(statement.instrumentsCreated).toBe(0)
  })

  it("linking an external key auto-routes the second import", async () => {
    const matched = await runtime.runPromise(
      Effect.gen(function* () {
        const account = yield* createInvAccount()
        const svc = yield* ImportService
        // First import with linkAccount: true records the mapping.
        yield* svc.ofxCommit({
          text: SAMPLE_INV_OFX,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: INV_EXTERNAL_KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
        // Second preview should surface the match.
        const preview = yield* svc.ofxPreview({ text: SAMPLE_INV_OFX })
        return preview.investmentStatements[0]?.matchedInvestmentAccountId ?? null
      }),
    )
    expect(matched).not.toBeNull()
  })

  it("a reinvested dividend emits both a Dividend and a Buy, and re-imports dedupe", async () => {
    const vanguardReinvest = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<INVSTMTRS>
<CURDEF>USD
<INVACCTFROM>
<BROKERID>vanguard.com
<ACCTID>57096170
</INVACCTFROM>
<INVTRANLIST>
<REINVDIV>
<INVTRAN>
<FITID>VG-REINV-1
<DTTRADE>20241031160000.000[-5:EST]
</INVTRAN>
<SECID>
<UNIQUEID>922908728
<UNIQUEIDTYPE>CUSIP
</SECID>
<INCOMETYPE>DIV
<TOTAL>-9.24
<UNITS>0.955
<UNITPRICE>9.68
</REINVDIV>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1>
<SECLIST>
<MFINFO>
<SECINFO>
<SECID><UNIQUEID>922908728<UNIQUEIDTYPE>CUSIP</SECID>
<SECNAME>Vanguard Total Bond Market Index Admiral
<TICKER>VBTLX
</SECINFO>
</MFINFO>
</SECLIST>
</SECLISTMSGSRSV1>
</OFX>`

    const INV_KEY = "ofx-inv:vanguard.com:57096170"
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const account = yield* acctSvc.create({
          name: "Vanguard",
          institution: "Vanguard",
          currency: USD,
        })
        const svc = yield* ImportService
        const first = yield* svc.ofxCommit({
          text: vanguardReinvest,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: INV_KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
        const holdings = yield* acctSvc.listHoldings(account.id)
        const second = yield* svc.ofxCommit({
          text: vanguardReinvest,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: INV_KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
        return { first, holdings, second }
      }),
    )
    // One reinvest element → two domain events (Dividend + Buy) → one lot.
    expect(result.holdings).toHaveLength(1)
    expect(result.holdings[0]?.quantity).toBe(95_500_000n)
    // 0.955 × $9.68 basis; actual cost basis carried is |total| = 924 cents.
    expect(result.holdings[0]?.costBasis.minor).toBe(924n)
    // First pass: 1 reinvest = 1 txn reported + 1 instrument created.
    expect(result.first.perInvestmentStatement[0]?.imported).toBe(1)
    expect(result.first.perInvestmentStatement[0]?.instrumentsCreated).toBe(1)
    // Second pass: no new work.
    expect(result.second.perInvestmentStatement[0]?.duplicates).toBe(1)
    expect(result.second.perInvestmentStatement[0]?.imported).toBe(0)
  })

  // -- Fidelity CSV -----------------------------------------------------

  const SAMPLE_FIDELITY_CSV = `

Run Date,Account,Account Number,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
04/15/2026,"Individual","Z35351644","YOU BOUGHT AMAZON.COM INC (AMZN) (Cash)",AMZN,"AMAZON.COM INC",Cash,200.00,10,,0.00,,-2000.00,04/16/2026
04/14/2026,"AMAZON 401(K) PLAN","34061","Contributions",,"VANGUARD TARGET 2070",,22.146,,,,,3965.75,,

"Date downloaded 04/17/2026"`

  it("fidelityPreview surfaces per-account stats and securities", async () => {
    const preview = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.fidelityPreview({ text: SAMPLE_FIDELITY_CSV })
      }),
    )
    expect(preview.statements).toHaveLength(2)
    const brokerage = preview.statements.find(
      (s) => s.accountNumber === "Z35351644",
    )!
    expect(brokerage.tradeCount).toBe(1)
    expect(brokerage.sample[0]?.symbol).toBe("AMZN")
  })

  it("fidelityCommit creates instruments, buys produce lots, re-import dedupes", async () => {
    const INDIVIDUAL_KEY = "csv-fidelity:Z35351644"
    const RETIREMENT_KEY = "csv-fidelity:34061"
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const individual = yield* acctSvc.create({
          name: "Fidelity Individual",
          institution: "Fidelity",
          currency: USD,
        })
        const retirement = yield* acctSvc.create({
          name: "Fidelity 401(k)",
          institution: "Fidelity",
          currency: USD,
        })
        const svc = yield* ImportService
        const first = yield* svc.fidelityCommit({
          text: SAMPLE_FIDELITY_CSV,
          assignments: [
            {
              externalKey: INDIVIDUAL_KEY,
              investmentAccountId: individual.id,
              linkAccount: true,
            },
            {
              externalKey: RETIREMENT_KEY,
              investmentAccountId: retirement.id,
              linkAccount: true,
            },
          ],
        })
        const holdings = yield* acctSvc.listHoldings()
        // Re-import — should be full duplicates.
        const second = yield* svc.fidelityCommit({
          text: SAMPLE_FIDELITY_CSV,
          assignments: [
            {
              externalKey: INDIVIDUAL_KEY,
              investmentAccountId: individual.id,
              linkAccount: true,
            },
            {
              externalKey: RETIREMENT_KEY,
              investmentAccountId: retirement.id,
              linkAccount: true,
            },
          ],
        })
        return { first, second, holdings }
      }),
    )
    // One brokerage buy + one 401(k) contribution = 2 instruments, 2 txns.
    expect(
      result.first.perStatement.reduce((n, s) => n + s.imported, 0),
    ).toBe(2)
    expect(
      result.first.perStatement.reduce((n, s) => n + s.instrumentsCreated, 0),
    ).toBe(2)
    expect(result.holdings).toHaveLength(2)
    // AMZN: 10 shares × $200 basis
    const amzn = result.holdings.find((h) => h.costBasis.minor === 200_000n)
    expect(amzn?.quantity).toBe(BigInt(10 * 1e8))
    // 401k: implied shares = 3965.75 / 22.146 (integer micro-units)
    const vtiv = result.holdings.find((h) => h.costBasis.minor === 396_575n)
    expect(vtiv?.quantity).toBe((396_575n * 100_000_000n) / 2214n)
    // Second run: zero imports, all dupes.
    expect(
      result.second.perStatement.reduce((n, s) => n + s.imported, 0),
    ).toBe(0)
    expect(
      result.second.perStatement.reduce((n, s) => n + s.duplicates, 0),
    ).toBe(2)
  })

  it("cross-source instrument dedup: Fidelity VTI is reused by a later OFX import", async () => {
    // Fidelity first.
    const fidelity = `

Run Date,Account,Account Number,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
04/15/2026,"Individual","Z12345","YOU BOUGHT VTI (Cash)",VTI,"VANGUARD TOTAL STOCK MARKET ETF",Cash,250.00,4,,0.00,,-1000.00,04/16/2026`

    // OFX file that carries the same ticker but a CUSIP-based SECID.
    const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<INVSTMTRS>
<CURDEF>USD
<INVACCTFROM>
<BROKERID>fidelity.com
<ACCTID>Z99999
</INVACCTFROM>
<INVTRANLIST>
<BUYSTOCK>
<INVBUY>
<INVTRAN><FITID>BUY-OFX-1<DTTRADE>20260420000000</INVTRAN>
<SECID><UNIQUEID>922908363<UNIQUEIDTYPE>CUSIP</SECID>
<UNITS>2
<UNITPRICE>260.00
<TOTAL>-520.00
</INVBUY>
<BUYTYPE>BUY
</BUYSTOCK>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1>
<SECLIST>
<STOCKINFO>
<SECINFO>
<SECID><UNIQUEID>922908363<UNIQUEIDTYPE>CUSIP</SECID>
<SECNAME>Vanguard Total Stock Market ETF
<TICKER>VTI
</SECINFO>
</STOCKINFO>
</SECLIST>
</SECLISTMSGSRSV1>
</OFX>`

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const instSvc = yield* InstrumentService
        const fidelityAccount = yield* acctSvc.create({
          name: "Fidelity",
          institution: "Fidelity",
          currency: USD,
        })
        const brokerAccount = yield* acctSvc.create({
          name: "Other Broker",
          institution: null,
          currency: USD,
        })
        const svc = yield* ImportService
        const firstOutcome = yield* svc.fidelityCommit({
          text: fidelity,
          assignments: [
            {
              externalKey: "csv-fidelity:Z12345",
              investmentAccountId: fidelityAccount.id,
              linkAccount: true,
            },
          ],
        })
        const afterFidelity = yield* instSvc.list
        const secondOutcome = yield* svc.ofxCommit({
          text: ofx,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: "ofx-inv:fidelity.com:Z99999",
              investmentAccountId: brokerAccount.id,
              linkAccount: true,
            },
          ],
        })
        const afterBoth = yield* instSvc.list
        return { firstOutcome, secondOutcome, afterFidelity, afterBoth }
      }),
    )
    // Exactly one VTI instrument exists across both imports.
    expect(result.afterFidelity).toHaveLength(1)
    expect(result.afterBoth).toHaveLength(1)
    expect(result.afterBoth[0]?.symbol).toBe("VTI")
    // OFX pass reused the existing instrument — instrumentsCreated is 0.
    expect(result.secondOutcome.perInvestmentStatement[0]?.instrumentsCreated).toBe(0)
  })

  it("cross-source instrument dedup: OFX VTI is reused by a later Fidelity import", async () => {
    const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<INVSTMTRS>
<CURDEF>USD
<INVACCTFROM>
<BROKERID>fidelity.com
<ACCTID>Z99999
</INVACCTFROM>
<INVTRANLIST>
<BUYSTOCK>
<INVBUY>
<INVTRAN><FITID>OFX-1<DTTRADE>20260101000000</INVTRAN>
<SECID><UNIQUEID>922908363<UNIQUEIDTYPE>CUSIP</SECID>
<UNITS>3
<UNITPRICE>200.00
<TOTAL>-600.00
</INVBUY>
<BUYTYPE>BUY
</BUYSTOCK>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1>
<SECLIST>
<STOCKINFO>
<SECINFO>
<SECID><UNIQUEID>922908363<UNIQUEIDTYPE>CUSIP</SECID>
<SECNAME>Vanguard Total Stock Market ETF
<TICKER>VTI
</SECINFO>
</STOCKINFO>
</SECLIST>
</SECLISTMSGSRSV1>
</OFX>`

    const fidelity = `

Run Date,Account,Account Number,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
04/15/2026,"Individual","Z12345","YOU BOUGHT VTI",VTI,"VANGUARD TOTAL STOCK MARKET ETF",Cash,250.00,2,,0.00,,-500.00,04/16/2026`

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const instSvc = yield* InstrumentService
        const ofxAccount = yield* acctSvc.create({
          name: "OFX",
          institution: null,
          currency: USD,
        })
        const fidelityAccount = yield* acctSvc.create({
          name: "Fid",
          institution: "Fidelity",
          currency: USD,
        })
        const svc = yield* ImportService
        yield* svc.ofxCommit({
          text: ofx,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: "ofx-inv:fidelity.com:Z99999",
              investmentAccountId: ofxAccount.id,
              linkAccount: false,
            },
          ],
        })
        const fidOutcome = yield* svc.fidelityCommit({
          text: fidelity,
          assignments: [
            {
              externalKey: "csv-fidelity:Z12345",
              investmentAccountId: fidelityAccount.id,
              linkAccount: false,
            },
          ],
        })
        const instruments = yield* instSvc.list
        return { fidOutcome, instruments }
      }),
    )
    expect(result.instruments).toHaveLength(1)
    expect(result.fidOutcome.perStatement[0]?.instrumentsCreated).toBe(0)
  })

  it("OFX INVBANKTRAN is emitted as cash events and is idempotent on re-import", async () => {
    const ofxWithCash = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<INVSTMTRS>
<CURDEF>USD
<INVACCTFROM>
<BROKERID>vanguard.com
<ACCTID>VX123
</INVACCTFROM>
<INVTRANLIST>
<INVBANKTRAN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20250105000000
<TRNAMT>1000.00
<FITID>CASH-IN-1
<NAME>ACH TRANSFER
</STMTTRN>
<SUBACCTFUND>CASH
</INVBANKTRAN>
<INVBANKTRAN>
<STMTTRN>
<TRNTYPE>FEE
<DTPOSTED>20250115000000
<TRNAMT>-7.00
<FITID>CASH-FEE-1
<NAME>ACCOUNT SERVICE FEE
</STMTTRN>
<SUBACCTFUND>CASH
</INVBANKTRAN>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`

    const KEY = "ofx-inv:vanguard.com:VX123"
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const account = yield* acctSvc.create({
          name: "Vanguard",
          institution: "Vanguard",
          currency: USD,
        })
        const svc = yield* ImportService
        const first = yield* svc.ofxCommit({
          text: ofxWithCash,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
        const balances = yield* acctSvc.listCashBalances(account.id)
        const second = yield* svc.ofxCommit({
          text: ofxWithCash,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: KEY,
              investmentAccountId: account.id,
              linkAccount: true,
            },
          ],
        })
        return { first, second, balances }
      }),
    )
    expect(result.first.perInvestmentStatement[0]?.imported).toBe(2)
    // $1000 in − $7 fee = $993
    expect(result.balances[0]?.minor).toBe(99_300n)
    // Re-import: no new events, all dupes.
    expect(result.second.perInvestmentStatement[0]?.imported).toBe(0)
    expect(result.second.perInvestmentStatement[0]?.duplicates).toBe(2)
  })

  it("Fidelity JOURNALED RSU lines commit as tax-kind cash flows", async () => {
    const fidelityCash = `

Run Date,Account,Account Number,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
04/16/2026,"Individual","Z12345","JOURNALED RSU Medicare (Cash)",,"No Description",Cash,,0.000,,,,-93.52,
04/16/2026,"Individual","Z12345","JOURNALED RSU US Federal Incom (Cash)",,"No Description",Cash,,0.000,,,,-1419.00,`

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const account = yield* acctSvc.create({
          name: "Fidelity",
          institution: "Fidelity",
          currency: USD,
        })
        const svc = yield* ImportService
        const outcome = yield* svc.fidelityCommit({
          text: fidelityCash,
          assignments: [
            {
              externalKey: "csv-fidelity:Z12345",
              investmentAccountId: account.id,
              linkAccount: false,
            },
          ],
        })
        const balances = yield* acctSvc.listCashBalances(account.id)
        const txnSvc = yield* InvestmentTransactionService
        const txns = yield* txnSvc.list({ accountId: account.id })
        return { outcome, balances, txns }
      }),
    )
    expect(result.outcome.perStatement[0]?.imported).toBe(2)
    // Both withholdings: -$93.52 + -$1419 = -$1512.52 → -151_252 cents
    expect(result.balances[0]?.minor).toBe(-151_252n)
    // Kind on projected rows is "tax".
    expect(result.txns.every((t) => t.kind === "tax")).toBe(true)
  })

  it("fidelityCommit skips unassigned statements without error", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const acctSvc = yield* InvestmentAccountService
        const individual = yield* acctSvc.create({
          name: "Fidelity Individual",
          institution: "Fidelity",
          currency: USD,
        })
        const svc = yield* ImportService
        // Only assign the brokerage account — 401(k) statement is unassigned.
        return yield* svc.fidelityCommit({
          text: SAMPLE_FIDELITY_CSV,
          assignments: [
            {
              externalKey: "csv-fidelity:Z35351644",
              investmentAccountId: individual.id,
              linkAccount: false,
            },
          ],
        })
      }),
    )
    expect(result.perStatement).toHaveLength(1)
    expect(result.perStatement[0]?.imported).toBe(1)
  })

  it("commit NotFound when assigned investment account does not exist", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ImportService
        return yield* svc.ofxCommit({
          text: SAMPLE_INV_OFX,
          assignments: [],
          investmentAssignments: [
            {
              externalKey: INV_EXTERNAL_KEY,
              investmentAccountId:
                "00000000-0000-0000-0000-000000000000" as never,
              linkAccount: false,
            },
          ],
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})
