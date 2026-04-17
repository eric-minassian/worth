import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  currency: text("currency").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  archivedAt: integer("archived_at", { mode: "number" }),
})
