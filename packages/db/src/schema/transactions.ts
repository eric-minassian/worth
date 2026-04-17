import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  postedAt: integer("posted_at", { mode: "number" }).notNull(),
  amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  payee: text("payee").notNull(),
  memo: text("memo"),
  categoryId: text("category_id"),
  importHash: text("import_hash"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
})
