import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  color: text("color"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
})
