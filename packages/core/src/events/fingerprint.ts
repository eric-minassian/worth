import { and, eq } from "drizzle-orm"
import type { DrizzleClient } from "@worth/db"
import { schema } from "@worth/db"
import type { AccountId, CurrencyCode } from "@worth/domain"

/**
 * Content fingerprint: does a transaction already exist in this account on
 * this posted timestamp with this exact amount+currency? Used as a cross-
 * format dedup so a CSV import followed by an OFX import of overlapping data
 * doesn't produce duplicates — the two paths use different `importHash`
 * schemes that can never collide on their own.
 *
 * Shared between the event applier (replay determinism) and the import
 * services (to report a duplicate count without appending the event).
 */
export const hasContentFingerprint = (
  db: DrizzleClient,
  accountId: AccountId,
  postedAt: number,
  amountMinor: bigint,
  currency: CurrencyCode,
): boolean =>
  db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.accountId, accountId),
        eq(schema.transactions.postedAt, postedAt),
        eq(schema.transactions.amountMinor, Number(amountMinor)),
        eq(schema.transactions.currency, currency),
      ),
    )
    .limit(1)
    .get() !== undefined
