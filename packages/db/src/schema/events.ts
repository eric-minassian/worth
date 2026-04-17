import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const events = sqliteTable("events", {
  eventId: text("event_id").primaryKey(),
  hlc: text("hlc").notNull(),
  deviceId: text("device_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  serverSeq: integer("server_seq", { mode: "number" }),
})
