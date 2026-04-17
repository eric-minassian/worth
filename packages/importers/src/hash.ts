import { createHash } from "node:crypto"
import type { AccountId } from "@worth/domain"
import type { MappedRow } from "./mapping"

/**
 * Stable per-row hash used to dedup re-imports. Two rows hash identically iff
 * they refer to the same account, posted date, amount, payee, and memo.
 *
 * Consequence: legitimate exact duplicates (two $5 coffees on the same day)
 * collide. That's acceptable for v1 — users can add a memo to disambiguate.
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
  return createHash("sha256").update(payload).digest("hex")
}
