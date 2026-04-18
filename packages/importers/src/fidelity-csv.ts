import { createHash } from "node:crypto"
import { QUANTITY_SCALE } from "@worth/domain"
import { parseCsv } from "./csv"
import { parseAmount, parseQuantity } from "./money"

// -- Types ------------------------------------------------------------------

/**
 * A single Fidelity activity row translated into Worth's investment-txn
 * shape. Mirrors `OfxInvTransaction` closely so downstream (ImportService)
 * can treat both sources uniformly.
 */
export type FidelityTransaction =
  | FidelityTradeTransaction
  | FidelityIncomeTransaction
  | FidelityReinvestTransaction
  | FidelityCashTransaction

/**
 * A non-instrument cash movement — `JOURNALED RSU …` tax withholdings,
 * account `Transfers`, fees, etc. `cashFlowKind` is our best guess based on
 * Action text + sign; downstream commits translate directly to
 * {@link FidelityCashTransaction} without further interpretation.
 */
export interface FidelityCashTransaction {
  readonly kind: "cash"
  readonly fitid: string
  readonly tradeDate: number
  /** Signed cash impact — positive = in, negative = out. */
  readonly amountMinor: bigint
  readonly memo: string
  readonly cashFlowKind:
    | "deposit"
    | "withdrawal"
    | "interest"
    | "fee"
    | "transfer"
    | "tax"
    | "other"
  readonly currency: string
}

export interface FidelityTradeTransaction {
  readonly kind: "buy" | "sell"
  /** Synthetic stable id — Fidelity CSV has no FITID. Hash-derived. */
  readonly fitid: string
  readonly tradeDate: number
  /** Ticker if present, else normalized description (for 401k funds). */
  readonly instrumentKey: FidelityInstrumentKey
  readonly units: bigint
  readonly unitPriceMinor: bigint
  readonly feesMinor: bigint
  readonly totalMinor: bigint
  readonly currency: string
}

export interface FidelityIncomeTransaction {
  readonly kind: "dividend"
  readonly fitid: string
  readonly tradeDate: number
  readonly instrumentKey: FidelityInstrumentKey
  readonly totalMinor: bigint
  readonly currency: string
  readonly incomeType: string | null
}

export interface FidelityReinvestTransaction {
  readonly kind: "reinvest"
  readonly fitid: string
  readonly tradeDate: number
  readonly instrumentKey: FidelityInstrumentKey
  readonly units: bigint
  readonly unitPriceMinor: bigint
  readonly feesMinor: bigint
  readonly totalMinor: bigint
  readonly currency: string
  readonly incomeType: string | null
}

/**
 * Dedup-stable identifier for the instrument described on a row. Tickers win
 * when present (cross-source dedup — a future non-Fidelity import that
 * references the same symbol resolves to the same instrument). 401k fund
 * rows have empty symbols; fall back to the description + name.
 */
export type FidelityInstrumentKey =
  | { readonly kind: "symbol"; readonly symbol: string; readonly name: string }
  | { readonly kind: "name"; readonly name: string }

export interface FidelityStatement {
  /** `Account Number` column value — used as the multi-account grouping key. */
  readonly accountNumber: string
  /** `Account` column value — the display name ("Individual", "AMAZON 401(K) PLAN"). */
  readonly accountLabel: string
  readonly transactions: readonly FidelityTransaction[]
}

export interface FidelityParseResult {
  readonly statements: readonly FidelityStatement[]
  readonly warnings: readonly string[]
}

/** Stable external key for linking a Fidelity account number to a Worth account. */
export const externalFidelityAccountKey = (accountNumber: string): string =>
  `csv-fidelity:${accountNumber}`

// -- Detection --------------------------------------------------------------

const EXPECTED_HEADERS = [
  "Run Date",
  "Account",
  "Account Number",
  "Action",
  "Symbol",
  "Description",
  "Type",
  "Price ($)",
  "Quantity",
  "Commission ($)",
  "Fees ($)",
  "Accrued Interest ($)",
  "Amount ($)",
  "Settlement Date",
] as const

/**
 * True if the file text starts (after optional blank + disclaimer lines)
 * with Fidelity's characteristic header row. Used by the importer registry
 * / UI to detect and route to this parser.
 */
export const isFidelityCsv = (text: string): boolean => {
  const head = text.slice(0, 4096)
  return head.includes("Run Date") && head.includes("Account Number") && head.includes("Action")
}

// -- Parser -----------------------------------------------------------------

interface FidelityRow {
  readonly runDate: string
  readonly account: string
  readonly accountNumber: string
  readonly action: string
  readonly symbol: string
  readonly description: string
  readonly price: string
  readonly quantity: string
  readonly commission: string
  readonly fees: string
  readonly amount: string
}

export const parseFidelityCsv = (text: string): FidelityParseResult => {
  const warnings: string[] = []
  const csv = parseCsv(text)

  const headerMatch = findFidelityHeader(csv.headers, csv.rows)
  if (!headerMatch) {
    return {
      statements: [],
      warnings: ["No Fidelity header row found in file"],
    }
  }
  const { headerRowIndex, columnMap } = headerMatch

  const byAccount = new Map<
    string,
    { label: string; transactions: FidelityTransaction[] }
  >()
  const seenFitids = new Set<string>()

  const dataRows = headerRowIndex === -1 ? csv.rows : csv.rows.slice(headerRowIndex + 1)
  for (const row of dataRows) {
    // Trailing disclaimer rows are quoted prose that splits into a single
    // long cell — anything this unstructured means we've left the data.
    if (isProseRow(row)) break
    const parsed = extractRow(row, columnMap)
    if (!parsed) continue
    if (parsed.runDate === "" && parsed.accountNumber === "") continue

    const txn = classifyRow(parsed, warnings)
    if (!txn) continue

    // Re-hash collisions within the same file would silently drop events;
    // surface a warning instead and suffix the id to keep them distinct.
    let uniqueFitid = txn.fitid
    if (seenFitids.has(uniqueFitid)) {
      warnings.push(
        `Duplicate content fingerprint on ${parsed.runDate} ${parsed.action.slice(0, 40)} — disambiguated`,
      )
      uniqueFitid = `${uniqueFitid}:${seenFitids.size}`
    }
    seenFitids.add(uniqueFitid)
    const finalTxn: FidelityTransaction = { ...txn, fitid: uniqueFitid }

    const existing = byAccount.get(parsed.accountNumber)
    if (existing) {
      existing.transactions.push(finalTxn)
    } else {
      byAccount.set(parsed.accountNumber, {
        label: parsed.account,
        transactions: [finalTxn],
      })
    }
  }

  const statements: FidelityStatement[] = []
  for (const [accountNumber, { label, transactions }] of byAccount) {
    statements.push({ accountNumber, accountLabel: label, transactions })
  }
  return { statements, warnings }
}

// -- Header detection -------------------------------------------------------

interface ColumnMap {
  readonly runDate: number
  readonly account: number
  readonly accountNumber: number
  readonly action: number
  readonly symbol: number
  readonly description: number
  readonly price: number
  readonly quantity: number
  readonly commission: number
  readonly fees: number
  readonly amount: number
}

/**
 * Fidelity emits two blank lines and sometimes a pre-header row before the
 * actual header. `parseCsv` took line 1 as the header which may be blank —
 * scan the first 10 rows (plus the headers row) looking for the real header.
 */
const findFidelityHeader = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): { headerRowIndex: number; columnMap: ColumnMap } | null => {
  if (matchesFidelityHeader(headers)) {
    return { headerRowIndex: -1, columnMap: buildColumnMap(headers) }
  }
  const lookahead = Math.min(rows.length, 10)
  for (let i = 0; i < lookahead; i++) {
    const row = rows[i]
    if (row && matchesFidelityHeader(row)) {
      return { headerRowIndex: i, columnMap: buildColumnMap(row) }
    }
  }
  return null
}

const matchesFidelityHeader = (cells: readonly string[]): boolean => {
  const present = new Set(cells.map((c) => c.trim()))
  return EXPECTED_HEADERS.every((h) => present.has(h))
}

const buildColumnMap = (cells: readonly string[]): ColumnMap => {
  const idx = (label: string): number => {
    const i = cells.findIndex((c) => c.trim() === label)
    return i === -1 ? -1 : i
  }
  return {
    runDate: idx("Run Date"),
    account: idx("Account"),
    accountNumber: idx("Account Number"),
    action: idx("Action"),
    symbol: idx("Symbol"),
    description: idx("Description"),
    price: idx("Price ($)"),
    quantity: idx("Quantity"),
    commission: idx("Commission ($)"),
    fees: idx("Fees ($)"),
    amount: idx("Amount ($)"),
  }
}

// -- Row extraction ---------------------------------------------------------

const extractRow = (
  row: readonly string[],
  map: ColumnMap,
): FidelityRow | null => {
  const get = (i: number): string => (i === -1 ? "" : (row[i] ?? "").trim())
  const runDate = get(map.runDate)
  const accountNumber = get(map.accountNumber)
  if (runDate === "" && accountNumber === "") return null
  return {
    runDate,
    account: get(map.account),
    accountNumber,
    action: get(map.action),
    symbol: get(map.symbol),
    description: get(map.description),
    price: get(map.price),
    quantity: get(map.quantity),
    commission: get(map.commission),
    fees: get(map.fees),
    amount: get(map.amount),
  }
}

/** Trailing disclaimer lines: single quoted cell of prose, no real columns. */
const isProseRow = (row: readonly string[]): boolean => {
  const nonEmpty = row.filter((c) => c.trim() !== "")
  if (nonEmpty.length !== 1) return false
  const first = nonEmpty[0] ?? ""
  return first.length > 40 && / /.test(first)
}

// -- Action classifier ------------------------------------------------------

const classifyRow = (
  row: FidelityRow,
  warnings: string[],
): FidelityTransaction | null => {
  const action = row.action.toUpperCase()
  const tradeDate = parseMdyDate(row.runDate)
  if (tradeDate === null) {
    warnings.push(`Unparseable date ${row.runDate}, skipped`)
    return null
  }
  const instrumentKey = buildInstrumentKey(row)
  if (!instrumentKey && needsInstrument(action)) {
    warnings.push(`Row missing symbol + description (${row.action}), skipped`)
    return null
  }

  if (action.startsWith("YOU BOUGHT") || action.startsWith("BOUGHT")) {
    return buildTrade("buy", row, tradeDate, instrumentKey!, warnings)
  }
  if (action.startsWith("YOU SOLD") || action.startsWith("SOLD")) {
    return buildTrade("sell", row, tradeDate, instrumentKey!, warnings)
  }
  if (action.startsWith("REINVESTMENT") || action.startsWith("REINVEST")) {
    return buildReinvest(row, tradeDate, instrumentKey!, warnings)
  }
  if (action.startsWith("DIVIDEND RECEIVED") || action.startsWith("INTEREST EARNED")) {
    return buildDividend(row, tradeDate, instrumentKey!)
  }
  if (action.startsWith("CONTRIBUTIONS")) {
    return buildContribution(row, tradeDate, instrumentKey!, warnings)
  }
  if (
    action.startsWith("JOURNALED") ||
    action.startsWith("TRANSFERS") ||
    action.startsWith("TRANSFER")
  ) {
    return buildCashMovement(row, tradeDate, warnings)
  }
  warnings.push(`Unknown action "${row.action.slice(0, 40)}" on ${row.runDate}, skipped`)
  return null
}

const needsInstrument = (action: string): boolean =>
  action.startsWith("YOU BOUGHT") ||
  action.startsWith("YOU SOLD") ||
  action.startsWith("BOUGHT") ||
  action.startsWith("SOLD") ||
  action.startsWith("REINVEST") ||
  action.startsWith("DIVIDEND") ||
  action.startsWith("INTEREST") ||
  action.startsWith("CONTRIBUTIONS")

const buildInstrumentKey = (row: FidelityRow): FidelityInstrumentKey | null => {
  const symbol = row.symbol.trim()
  const description = row.description.trim()
  if (symbol.length > 0) {
    return {
      kind: "symbol",
      symbol: symbol.toUpperCase(),
      name: description.length > 0 ? description : symbol,
    }
  }
  if (description.length > 0) {
    return { kind: "name", name: description }
  }
  return null
}

const buildTrade = (
  kind: "buy" | "sell",
  row: FidelityRow,
  tradeDate: number,
  instrumentKey: FidelityInstrumentKey,
  warnings: string[],
): FidelityTradeTransaction | null => {
  const priceMinor = parseAmount(row.price) ?? 0n
  const qty = parseQuantity(row.quantity)
  if (qty === null) {
    warnings.push(`Unparseable quantity on ${row.runDate}, skipped`)
    return null
  }
  const units = qty < 0n ? -qty : qty
  const fees = absOrZero(parseAmount(row.fees)) + absOrZero(parseAmount(row.commission))
  const amount = parseAmount(row.amount) ?? fallbackTotal(kind, units, priceMinor, fees)
  return {
    kind,
    fitid: contentFitid(row),
    tradeDate,
    instrumentKey,
    units,
    unitPriceMinor: priceMinor,
    feesMinor: fees,
    totalMinor: amount,
    currency: "USD",
  }
}

const buildReinvest = (
  row: FidelityRow,
  tradeDate: number,
  instrumentKey: FidelityInstrumentKey,
  warnings: string[],
): FidelityReinvestTransaction | null => {
  const priceMinor = parseAmount(row.price) ?? 0n
  const qty = parseQuantity(row.quantity)
  if (qty === null) {
    warnings.push(`Unparseable reinvest quantity on ${row.runDate}, skipped`)
    return null
  }
  const units = qty < 0n ? -qty : qty
  const fees = absOrZero(parseAmount(row.fees)) + absOrZero(parseAmount(row.commission))
  const totalRaw = parseAmount(row.amount) ?? 0n
  const totalMinor = totalRaw < 0n ? -totalRaw : totalRaw
  return {
    kind: "reinvest",
    fitid: contentFitid(row),
    tradeDate,
    instrumentKey,
    units,
    unitPriceMinor: priceMinor,
    feesMinor: fees,
    totalMinor,
    currency: "USD",
    incomeType: null,
  }
}

const buildDividend = (
  row: FidelityRow,
  tradeDate: number,
  instrumentKey: FidelityInstrumentKey,
): FidelityIncomeTransaction | null => {
  const amount = parseAmount(row.amount)
  if (amount === null) return null
  const totalMinor = amount < 0n ? -amount : amount
  const incomeType = row.action.toUpperCase().startsWith("INTEREST")
    ? "INTEREST"
    : "DIV"
  return {
    kind: "dividend",
    fitid: contentFitid(row),
    tradeDate,
    instrumentKey,
    totalMinor,
    currency: "USD",
    incomeType,
  }
}

const buildCashMovement = (
  row: FidelityRow,
  tradeDate: number,
  warnings: string[],
): FidelityCashTransaction | null => {
  const amount = parseAmount(row.amount) ?? 0n
  if (amount === 0n) {
    // Zero-amount Transfers / JOURNALED are informational only.
    warnings.push(`Skipped zero-amount "${row.action}" on ${row.runDate}`)
    return null
  }
  const upper = row.action.toUpperCase()
  const cashFlowKind = classifyFidelityCashAction(upper, amount)
  return {
    kind: "cash",
    fitid: contentFitid(row),
    tradeDate,
    amountMinor: amount,
    memo: row.action,
    cashFlowKind,
    currency: "USD",
  }
}

/**
 * Heuristic classifier for Fidelity's free-text Action column. RSU-withheld
 * tax lines (CA SDI, Medicare, federal income, etc.) all share "JOURNALED
 * RSU" prefix; plain `Transfers` default to transfer. Fallback uses the
 * signed amount: positive cash in = deposit, negative = withdrawal.
 */
const classifyFidelityCashAction = (
  upper: string,
  amount: bigint,
): FidelityCashTransaction["cashFlowKind"] => {
  if (upper.startsWith("JOURNALED")) {
    // All "JOURNALED RSU …" lines are tax-related cash flows (withheld
    // contributions + occasional refunds). Sign carries the direction.
    if (upper.includes("RSU")) return "tax"
    return amount >= 0n ? "deposit" : "withdrawal"
  }
  if (upper.startsWith("TRANSFER")) return "transfer"
  if (upper.includes("FEE")) return "fee"
  if (upper.includes("INTEREST")) return "interest"
  return amount >= 0n ? "deposit" : "withdrawal"
}

const buildContribution = (
  row: FidelityRow,
  tradeDate: number,
  instrumentKey: FidelityInstrumentKey,
  warnings: string[],
): FidelityTradeTransaction | null => {
  // 401(k) Contributions list Price (NAV) + Amount, with Quantity implied
  // (shares = amount / price). Quantity column is often blank.
  const priceMinor = parseAmount(row.price) ?? 0n
  const amount = parseAmount(row.amount) ?? 0n
  if (amount <= 0n || priceMinor <= 0n) {
    warnings.push(
      `Contribution on ${row.runDate} missing price/amount, skipped`,
    )
    return null
  }
  let units = parseQuantity(row.quantity)
  if (units === null || units === 0n) {
    // units (micro) = (amount_minor / price_minor) * QUANTITY_SCALE — all
    // in bigint to avoid precision loss on small contributions.
    units = (amount * QUANTITY_SCALE) / priceMinor
  } else if (units < 0n) {
    units = -units
  }
  const fees = absOrZero(parseAmount(row.fees)) + absOrZero(parseAmount(row.commission))
  return {
    kind: "buy",
    fitid: contentFitid(row),
    tradeDate,
    instrumentKey,
    units,
    unitPriceMinor: priceMinor,
    feesMinor: fees,
    totalMinor: -amount,
    currency: "USD",
  }
}

// -- Helpers ----------------------------------------------------------------

const absOrZero = (v: bigint | null): bigint =>
  v === null ? 0n : v < 0n ? -v : v

const fallbackTotal = (
  kind: "buy" | "sell",
  units: bigint,
  unitPriceMinor: bigint,
  feesMinor: bigint,
): bigint => {
  const gross = (units * unitPriceMinor) / QUANTITY_SCALE
  return kind === "buy" ? -(gross + feesMinor) : gross - feesMinor
}

/** MM/DD/YYYY → UTC midnight ms. */
const parseMdyDate = (raw: string): number | null => {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return Date.UTC(year, month - 1, day)
}

/**
 * Content-derived stable id. Same row shape across re-imports must yield the
 * same hash so the projection dedup makes repeat imports idempotent.
 */
const contentFitid = (row: FidelityRow): string => {
  const payload = [
    row.accountNumber,
    row.runDate,
    row.action,
    row.symbol,
    row.description,
    row.price,
    row.quantity,
    row.amount,
  ].join("|")
  return createHash("sha256").update(payload).digest("hex").slice(0, 32)
}
