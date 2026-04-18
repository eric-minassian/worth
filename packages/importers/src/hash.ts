import { createHash } from "node:crypto"
import type { AccountId } from "@worth/domain"
import type { MappedRow } from "./mapping"
import { IMPORT_SOURCE_PREFIX } from "./source"

/**
 * Stable per-row hash used to dedup re-imports. Two rows hash identically iff
 * they refer to the same account, posted date, amount, payee, and memo.
 *
 * Consequence: legitimate exact duplicates (two $5 coffees on the same day)
 * collide. That's acceptable for v1 — users can add a memo to disambiguate.
 *
 * The `csv:` prefix lets the UI distinguish a CSV-imported row from an
 * OFX-imported row after the fact; sha256 alone is opaque.
 */
export const computeImportHash = (accountId: AccountId, row: MappedRow): string => {
  const payload = [
    accountId,
    row.postedAt,
    row.amount.minor.toString(),
    row.amount.currency,
    row.payee,
    row.memo ?? "",
  ].join("|")
  return `${IMPORT_SOURCE_PREFIX.csv}${createHash("sha256").update(payload).digest("hex")}`
}

/**
 * Stable per-row hash for OFX/QFX imports. The bank's FITID is already a
 * stable per-account identifier, so the dedup key is just the namespaced
 * (accountId, fitid) tuple — re-importing the same OFX file is a no-op even
 * if the bank later edits the payee or memo for that transaction.
 */
export const computeOfxImportHash = (accountId: AccountId, fitid: string): string =>
  `${IMPORT_SOURCE_PREFIX.ofx}${createHash("sha256").update(`ofx|${accountId}|${fitid}`).digest("hex")}`
