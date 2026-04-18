import { describe, expect, it } from "vitest"
import {
  externalFidelityAccountKey,
  isFidelityCsv,
  parseFidelityCsv,
} from "../src"

// Minimal synthetic Fidelity export covering: leading blank lines, a real
// header row, brokerage buy/sell (including signed-negative sell Quantity),
// 401(k) Contributions (Price-as-NAV, Amount-only), a JOURNALED tax line
// that should be skipped with a warning, and a trailing disclaimer block.
const FIDELITY_CSV = `

Run Date,Account,Account Number,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
04/15/2026,"Individual","Z35351644","YOU BOUGHT RSU AMAZON.COM INC (AMZN) (Cash)",AMZN,"AMAZON.COM INC",Cash,,26,,,,0.00,04/16/2026
04/15/2026,"Individual","Z35351644","YOU SOLD VSP AMAZON.COM INC (AMZN) (Cash)",AMZN,"AMAZON.COM INC",Cash,248.08,-11,,0.06,,2728.78,04/16/2026
04/14/2026,"AMAZON 401(K) PLAN","34061","Contributions",,"VANGUARD TARGET 2070",,22.146,,,,,3965.75,,
04/16/2026,"Individual","Z35351644","JOURNALED RSU Refund (Cash)",,"No Description",Cash,,0.000,,,,-72.68,


"The data and information in this spreadsheet is provided to you solely for your use and is not for distribution."
"Date downloaded 04/17/2026 8:03 pm"`

describe("isFidelityCsv", () => {
  it("detects the characteristic header row", () => {
    expect(isFidelityCsv(FIDELITY_CSV)).toBe(true)
  })
  it("rejects a generic CSV", () => {
    expect(isFidelityCsv("Date,Amount,Payee\n2024-01-01,10.00,x")).toBe(false)
  })
})

describe("parseFidelityCsv", () => {
  const result = parseFidelityCsv(FIDELITY_CSV)

  it("groups transactions by Account Number", () => {
    expect(result.statements).toHaveLength(2)
    const byNumber = new Map(
      result.statements.map((s) => [s.accountNumber, s] as const),
    )
    expect(byNumber.has("Z35351644")).toBe(true)
    expect(byNumber.has("34061")).toBe(true)
  })

  it("parses a brokerage buy with zero-cost RSU grant", () => {
    const brokerage = result.statements.find(
      (s) => s.accountNumber === "Z35351644",
    )!
    const buy = brokerage.transactions.find((t) => t.kind === "buy")!
    expect(buy.kind).toBe("buy")
    expect("units" in buy ? buy.units : null).toBe(BigInt(26 * 1e8))
    expect("totalMinor" in buy ? buy.totalMinor : null).toBe(0n)
  })

  it("parses a sell with negative Quantity (abs-valued in output)", () => {
    const brokerage = result.statements.find(
      (s) => s.accountNumber === "Z35351644",
    )!
    const sell = brokerage.transactions.find((t) => t.kind === "sell")!
    expect(sell.kind).toBe("sell")
    expect("units" in sell ? sell.units : null).toBe(BigInt(11 * 1e8))
    expect("unitPriceMinor" in sell ? sell.unitPriceMinor : null).toBe(24808n)
    expect("totalMinor" in sell ? sell.totalMinor : null).toBe(272878n)
    expect("feesMinor" in sell ? sell.feesMinor : null).toBe(6n)
  })

  it("parses a 401(k) Contribution, computing implied units from Amount/Price", () => {
    const retirement = result.statements.find(
      (s) => s.accountNumber === "34061",
    )!
    expect(retirement.transactions).toHaveLength(1)
    const contribution = retirement.transactions[0]!
    expect(contribution.kind).toBe("buy")
    // 3965.75 / 22.146 ≈ 179.12 shares; integer math: 396575 * 1e8 / 2214 = 17911924118
    expect("units" in contribution ? contribution.units : null).toBe(
      (396575n * 100_000_000n) / 2214n,
    )
    expect("totalMinor" in contribution ? contribution.totalMinor : null).toBe(
      -396575n,
    )
    expect(contribution.instrumentKey).toEqual({
      kind: "name",
      name: "VANGUARD TARGET 2070",
    })
  })

  it("emits JOURNALED rows as cash transactions with classified kinds", () => {
    const all = result.statements.flatMap((s) => s.transactions)
    const journaled = all.find(
      (t) => t.kind === "cash" && /JOURNALED/.test(t.memo),
    )
    expect(journaled?.kind).toBe("cash")
    expect(
      journaled && "cashFlowKind" in journaled ? journaled.cashFlowKind : null,
    ).toBe("tax")
    // Tax-withholding rows are cash out (negative amount).
    expect(
      journaled && "amountMinor" in journaled ? journaled.amountMinor : null,
    ).toBe(-7268n)
  })

  it("stops at the trailing disclaimer block", () => {
    expect(
      result.warnings.every((w) => !/The data and information/.test(w)),
    ).toBe(true)
  })

  it("emits stable fitids — repeated parsing of same text yields same ids", () => {
    const first = parseFidelityCsv(FIDELITY_CSV)
    const second = parseFidelityCsv(FIDELITY_CSV)
    const ids1 = first.statements
      .flatMap((s) => s.transactions.map((t) => t.fitid))
      .sort()
    const ids2 = second.statements
      .flatMap((s) => s.transactions.map((t) => t.fitid))
      .sort()
    expect(ids1).toEqual(ids2)
  })
})

describe("externalFidelityAccountKey", () => {
  it("namespaces under csv-fidelity:", () => {
    expect(externalFidelityAccountKey("Z35351644")).toBe(
      "csv-fidelity:Z35351644",
    )
  })
})
