import { describe, expect, it } from "vitest"
import type { CurrencyCode } from "@worth/domain"
import { mapRows, parseCsv, suggestMapping } from "../src"

const USD = "USD" as CurrencyCode

describe("parseCsv", () => {
  it("splits header + data rows and trims cells", () => {
    const csv = parseCsv("Date, Payee , Amount\n2024-01-15 ,Whole Foods, -12.50\n")
    expect(csv.headers).toEqual(["Date", "Payee", "Amount"])
    expect(csv.rows).toEqual([["2024-01-15", "Whole Foods", "-12.50"]])
  })

  it("handles quoted cells with embedded commas", () => {
    const csv = parseCsv('Date,Payee,Amount\n2024-01-15,"Smith, John",42\n')
    expect(csv.rows).toEqual([["2024-01-15", "Smith, John", "42"]])
  })

  it("drops trailing empty lines", () => {
    const csv = parseCsv("Date,Payee,Amount\n2024-01-15,A,1\n\n\n")
    expect(csv.rows).toHaveLength(1)
  })

  it("returns empty result for empty input", () => {
    const csv = parseCsv("")
    expect(csv).toEqual({ headers: [], rows: [] })
  })
})

describe("suggestMapping", () => {
  it("recognizes common bank headers", () => {
    const m = suggestMapping(["Posted Date", "Description", "Amount", "Notes"])
    expect(m).toEqual({ 0: "date", 1: "payee", 2: "amount", 3: "memo" })
  })

  it("maps unknown columns to skip", () => {
    const m = suggestMapping(["Date", "Weird", "Amount"])
    expect(m[0]).toBe("date")
    expect(m[1]).toBe("skip")
    expect(m[2]).toBe("amount")
  })

  it("only assigns each role once", () => {
    const m = suggestMapping(["Amount", "Amount", "Amount"])
    const roles = Object.values(m).filter((r) => r === "amount")
    expect(roles).toHaveLength(1)
  })
})

describe("mapRows", () => {
  const mapping = { 0: "date", 1: "payee", 2: "amount", 3: "memo" } as const

  it("parses ISO dates and negative amounts", () => {
    const csv = parseCsv("Date,Payee,Amount,Memo\n2024-01-15,Whole Foods,-12.50,groceries\n")
    const result = mapRows(csv.headers, csv.rows, mapping, USD)
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    if (!row) throw new Error("expected a row")
    expect(row.amount.minor).toBe(-1250n)
    expect(row.payee).toBe("Whole Foods")
    expect(row.memo).toBe("groceries")
  })

  it("parses MM/DD/YYYY dates and parenthesized negatives", () => {
    const csv = parseCsv("Date,Payee,Amount\n01/15/2024,Target,(19.99)\n")
    const result = mapRows(csv.headers, csv.rows, mapping, USD)
    const row = result.rows[0]
    if (!row) throw new Error("expected a row")
    expect(row.amount.minor).toBe(-1999n)
    expect(new Date(row.postedAt).getFullYear()).toBe(2024)
  })

  it("strips currency symbols and thousands separators", () => {
    const csv = parseCsv('Date,Payee,Amount\n2024-01-15,Car,"$1,234.56"\n')
    const result = mapRows(csv.headers, csv.rows, mapping, USD)
    const row = result.rows[0]
    if (!row) throw new Error("expected a row")
    expect(row.amount.minor).toBe(123456n)
  })

  it("emits a row error for unparseable amounts", () => {
    const csv = parseCsv("Date,Payee,Amount\n2024-01-15,A,NOT_A_NUMBER\n")
    const result = mapRows(csv.headers, csv.rows, mapping, USD)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]?.message).toMatch(/amount/)
  })

  it("emits a top-level error when required columns are missing", () => {
    const csv = parseCsv("Col1,Col2,Col3\na,b,c\n")
    const result = mapRows(csv.headers, csv.rows, {}, USD)
    expect(result.rows).toHaveLength(0)
    expect(result.errors.some((e) => /date/i.test(e.message))).toBe(true)
    expect(result.errors.some((e) => /payee/i.test(e.message))).toBe(true)
    expect(result.errors.some((e) => /amount/i.test(e.message))).toBe(true)
  })
})
