import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Records a user's decision that a specific set of transactions is NOT a
 * duplicate group. `memberKey` is the sorted member ids joined by `,` — the
 * sort order is canonical so the same set of ids always maps to the same
 * key. `memberIds` stores the original JSON-serialized array for audit.
 */
export const duplicateDismissals = sqliteTable("duplicate_dismissals", {
  memberKey: text("member_key").primaryKey(),
  memberIds: text("member_ids").notNull(),
  dismissedAt: integer("dismissed_at", { mode: "number" }).notNull(),
})
