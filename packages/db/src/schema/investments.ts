import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const instruments = sqliteTable("instruments", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  currency: text("currency").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
})

export const investmentAccounts = sqliteTable("investment_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  institution: text("institution"),
  currency: text("currency").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  archivedAt: integer("archived_at", { mode: "number" }),
})

/**
 * Links an OFX investment source (or other external source) to a Worth
 * investment account. Parallel to {@link accountExternalKeys} but in a
 * separate table so FK targets stay well-typed.
 */
export const investmentAccountExternalKeys = sqliteTable(
  "investment_account_external_keys",
  {
    externalKey: text("external_key").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => investmentAccounts.id),
    linkedAt: integer("linked_at", { mode: "number" }).notNull(),
  },
  (t) => [index("investment_account_external_keys_account_idx").on(t.accountId)],
)

/**
 * One tax lot per buy. `remainingQuantity` + `remainingCostBasisMinor` are
 * consumed FIFO by sells and multiplied in place by splits. Quantities are
 * stored as signed 53-bit integers in 1e-8 micro-share units — adequate for
 * personal-finance-scale holdings (~9e15 / 1e8 = 90M shares per lot).
 */
export const lots = sqliteTable(
  "lots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => investmentAccounts.id),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    openedAt: integer("opened_at", { mode: "number" }).notNull(),
    originalQuantity: integer("original_quantity", { mode: "number" }).notNull(),
    remainingQuantity: integer("remaining_quantity", { mode: "number" }).notNull(),
    originalCostBasisMinor: integer("original_cost_basis_minor", {
      mode: "number",
    }).notNull(),
    remainingCostBasisMinor: integer("remaining_cost_basis_minor", {
      mode: "number",
    }).notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [
    index("lots_account_instrument_idx").on(t.accountId, t.instrumentId),
    index("lots_fifo_idx").on(t.accountId, t.instrumentId, t.openedAt, t.id),
  ],
)

/**
 * Aggregate across lots for (account, instrument). Maintained alongside `lots`
 * so the UI doesn't re-aggregate on every read. Rebuildable from events.
 */
export const holdings = sqliteTable(
  "holdings",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => investmentAccounts.id),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    quantity: integer("quantity", { mode: "number" }).notNull(),
    costBasisMinor: integer("cost_basis_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.instrumentId] }),
    index("holdings_account_idx").on(t.accountId),
  ],
)

/**
 * Display-layer record of every investment event that affected an account.
 * Not a source of truth — rebuildable from the event log.
 */
export const investmentTransactions = sqliteTable(
  "investment_transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => investmentAccounts.id),
    instrumentId: text("instrument_id").references(() => instruments.id),
    kind: text("kind").notNull(),
    postedAt: integer("posted_at", { mode: "number" }).notNull(),
    quantity: integer("quantity", { mode: "number" }),
    pricePerShareMinor: integer("price_per_share_minor", { mode: "number" }),
    feesMinor: integer("fees_minor", { mode: "number" }),
    amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
    memo: text("memo"),
    splitNumerator: integer("split_numerator", { mode: "number" }),
    splitDenominator: integer("split_denominator", { mode: "number" }),
    currency: text("currency").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("investment_transactions_account_posted_idx").on(t.accountId, t.postedAt),
  ],
)

export const priceQuotes = sqliteTable(
  "price_quotes",
  {
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    asOf: integer("as_of", { mode: "number" }).notNull(),
    priceMinor: integer("price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    recordedAt: integer("recorded_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.asOf] })],
)
