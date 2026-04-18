import type { CurrencyCode, Money } from "@worth/domain"
import { parseAmount } from "./money"

export type ColumnRole = "date" | "payee" | "amount" | "memo" | "skip"

export type ColumnMapping = Readonly<Record<number, ColumnRole>>

export interface MappedRow {
  readonly postedAt: number
  readonly amount: Money
  readonly payee: string
  readonly memo: string | null
}

export interface MapError {
  readonly rowIndex: number
  readonly message: string
}

export interface MapResult {
  readonly rows: readonly MappedRow[]
  readonly errors: readonly MapError[]
}

const HEADER_RULES: readonly [RegExp, ColumnRole][] = [
  [/^(date|posted\s*(date)?|transaction\s*date|post\s*date)$/i, "date"],
  [/^(description|payee|merchant|name|details?)$/i, "payee"],
  [/^(amount|debit|credit|value)$/i, "amount"],
  [/^(memo|notes?|reference|category)$/i, "memo"],
]

/** Best-effort column-role suggestion based on common bank CSV header names. */
export const suggestMapping = (headers: readonly string[]): ColumnMapping => {
  const mapping: Record<number, ColumnRole> = {}
  const used = new Set<ColumnRole>()
  headers.forEach((header, idx) => {
    for (const [pattern, role] of HEADER_RULES) {
      if (pattern.test(header) && !used.has(role)) {
        mapping[idx] = role
        used.add(role)
        return
      }
    }
    mapping[idx] = "skip"
  })
  return mapping
}

/**
 * Parse a date cell to UTC midnight. Anchoring at UTC midnight — not local —
 * is what lets a CSV row and an OFX row for the same calendar day hash to the
 * same `postedAt`, which is what the cross-format content fingerprint relies on.
 */
const parseDate = (value: string): number | null => {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (iso) {
    const [, y = "", m = "", d = ""] = iso
    return Date.UTC(Number(y), Number(m) - 1, Number(d))
  }
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    const [, a = "", b = "", c = ""] = slash
    const year = c.length === 2 ? 2000 + Number(c) : Number(c)
    return Date.UTC(year, Number(a) - 1, Number(b))
  }
  return null
}

/** Given a parsed CSV, mapping, and target currency, produce mapped rows + errors. */
export const mapRows = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  currency: CurrencyCode,
): MapResult => {
  const mapped: MappedRow[] = []
  const errors: MapError[] = []

  const roleColumn = (role: ColumnRole): number | null => {
    for (const [col, assigned] of Object.entries(mapping)) {
      if (assigned === role) return Number(col)
    }
    return null
  }

  const dateCol = roleColumn("date")
  const payeeCol = roleColumn("payee")
  const amountCol = roleColumn("amount")
  const memoCol = roleColumn("memo")

  if (dateCol === null) {
    errors.push({ rowIndex: -1, message: "Missing 'date' column mapping" })
  }
  if (payeeCol === null) {
    errors.push({ rowIndex: -1, message: "Missing 'payee' column mapping" })
  }
  if (amountCol === null) {
    errors.push({ rowIndex: -1, message: "Missing 'amount' column mapping" })
  }
  if (headers.length === 0) {
    errors.push({ rowIndex: -1, message: "CSV has no header row" })
  }
  if (errors.length > 0) return { rows: [], errors }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const rawDate = row[dateCol as number] ?? ""
    const rawPayee = row[payeeCol as number] ?? ""
    const rawAmount = row[amountCol as number] ?? ""
    const rawMemo = memoCol !== null ? row[memoCol] : undefined

    const postedAt = parseDate(rawDate)
    const amountMinor = parseAmount(rawAmount)

    if (postedAt === null) {
      errors.push({ rowIndex: i, message: `Unparseable date "${rawDate}"` })
      continue
    }
    if (amountMinor === null) {
      errors.push({ rowIndex: i, message: `Unparseable amount "${rawAmount}"` })
      continue
    }
    if (rawPayee.trim().length === 0) {
      errors.push({ rowIndex: i, message: "Empty payee" })
      continue
    }

    mapped.push({
      postedAt,
      amount: { minor: amountMinor, currency },
      payee: rawPayee.trim(),
      memo: rawMemo && rawMemo.trim().length > 0 ? rawMemo.trim() : null,
    })
  }

  return { rows: mapped, errors }
}
