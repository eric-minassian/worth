import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  currency: text("currency").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  archivedAt: integer("archived_at", { mode: "number" }),
})

/**
 * Links an external data source (e.g. an OFX file's BANKID+ACCTID pair) to a
 * Worth account so repeat imports auto-route. One Worth account may have many
 * external keys; each external key maps to exactly one account.
 */
export const accountExternalKeys = sqliteTable(
  "account_external_keys",
  {
    externalKey: text("external_key").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    linkedAt: integer("linked_at", { mode: "number" }).notNull(),
  },
  (t) => [index("account_external_keys_account_idx").on(t.accountId)],
)
