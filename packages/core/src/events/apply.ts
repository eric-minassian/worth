import { and, eq, isNotNull } from "drizzle-orm"
import type { DrizzleClient } from "@worth/db"
import { schema } from "@worth/db"
import type { DomainEvent } from "@worth/domain"
import { hasContentFingerprint } from "./fingerprint"

/**
 * Apply a single event to the projection tables. Called inside the same
 * transaction that appends to the event log. Must be deterministic — given
 * the same event, produces the same projection change.
 */
export const applyEvent = (db: DrizzleClient, event: DomainEvent): void => {
  switch (event._tag) {
    case "AccountCreated":
      db.insert(schema.accounts)
        .values({
          id: event.id,
          name: event.name,
          type: event.type,
          currency: event.currency,
          createdAt: event.at,
          archivedAt: null,
        })
        .onConflictDoNothing()
        .run()
      return

    case "AccountRenamed":
      db.update(schema.accounts)
        .set({ name: event.name })
        .where(eq(schema.accounts.id, event.id))
        .run()
      return

    case "AccountArchived":
      db.update(schema.accounts)
        .set({ archivedAt: event.at })
        .where(eq(schema.accounts.id, event.id))
        .run()
      return

    case "AccountExternalKeyLinked":
      db.insert(schema.accountExternalKeys)
        .values({
          externalKey: event.externalKey,
          accountId: event.id,
          linkedAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return

    case "CategoryCreated":
      db.insert(schema.categories)
        .values({
          id: event.id,
          name: event.name,
          parentId: event.parentId,
          color: event.color,
          createdAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return

    case "TransactionImported": {
      // Dedup by (account_id, import_hash) when an import hash is present.
      if (event.importHash !== null) {
        const existing = db
          .select({ id: schema.transactions.id })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.accountId, event.accountId),
              isNotNull(schema.transactions.importHash),
              eq(schema.transactions.importHash, event.importHash),
            ),
          )
          .limit(1)
          .all()
        if (existing.length > 0) return
      }
      // Gated to importHash !== null so manual TransactionService.create
      // retains its "duplicate-looking rows are allowed" semantics.
      if (
        event.importHash !== null &&
        hasContentFingerprint(
          db,
          event.accountId,
          event.postedAt,
          event.amount.minor,
          event.amount.currency,
        )
      ) {
        return
      }
      db.insert(schema.transactions)
        .values({
          id: event.id,
          accountId: event.accountId,
          postedAt: event.postedAt,
          amountMinor: Number(event.amount.minor),
          currency: event.amount.currency,
          payee: event.payee,
          memo: event.memo,
          categoryId: null,
          importHash: event.importHash,
          createdAt: event.at,
          updatedAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return
    }

    case "TransactionCategorized":
      db.update(schema.transactions)
        .set({ categoryId: event.categoryId, updatedAt: event.at })
        .where(eq(schema.transactions.id, event.id))
        .run()
      return

    case "TransactionEdited": {
      const patch: Partial<typeof schema.transactions.$inferInsert> = {
        updatedAt: event.at,
      }
      if (event.postedAt !== undefined) patch.postedAt = event.postedAt
      if (event.amount !== undefined) {
        patch.amountMinor = Number(event.amount.minor)
        patch.currency = event.amount.currency
      }
      if (event.payee !== undefined) patch.payee = event.payee
      if (event.memo !== undefined) patch.memo = event.memo
      db.update(schema.transactions)
        .set(patch)
        .where(eq(schema.transactions.id, event.id))
        .run()
      return
    }

    case "TransactionDeleted":
      db.delete(schema.transactions).where(eq(schema.transactions.id, event.id)).run()
      return

    case "DuplicateGroupDismissed": {
      const sorted = [...event.memberIds].sort()
      const key = sorted.join(",")
      db.insert(schema.duplicateDismissals)
        .values({
          memberKey: key,
          memberIds: JSON.stringify(sorted),
          dismissedAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return
    }
  }
}
