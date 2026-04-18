import { Schema } from "effect"
import { AccountType, CashFlowKind, InstrumentKind } from "./entities"
import {
  AccountId,
  CategoryId,
  CurrencyCode,
  InstrumentId,
  InvestmentAccountId,
  InvestmentTransactionId,
  Money,
  Quantity,
  TransactionId,
} from "./primitives"

// -- Domain events ----------------------------------------------------------
//
// Events are the single write interface. Each mutation produces one or more
// events; projections are derived. Every event carries enough information to
// reconstruct the affected state without reading anything else.

export const AccountCreated = Schema.TaggedStruct("AccountCreated", {
  id: AccountId,
  name: Schema.String,
  type: AccountType,
  currency: CurrencyCode,
  at: Schema.Number,
})
export type AccountCreated = Schema.Schema.Type<typeof AccountCreated>

export const AccountRenamed = Schema.TaggedStruct("AccountRenamed", {
  id: AccountId,
  name: Schema.String,
})
export type AccountRenamed = Schema.Schema.Type<typeof AccountRenamed>

export const AccountArchived = Schema.TaggedStruct("AccountArchived", {
  id: AccountId,
  at: Schema.Number,
})
export type AccountArchived = Schema.Schema.Type<typeof AccountArchived>

export const CategoryCreated = Schema.TaggedStruct("CategoryCreated", {
  id: CategoryId,
  name: Schema.String,
  parentId: Schema.NullOr(CategoryId),
  color: Schema.NullOr(Schema.String),
  at: Schema.Number,
})
export type CategoryCreated = Schema.Schema.Type<typeof CategoryCreated>

export const TransactionImported = Schema.TaggedStruct("TransactionImported", {
  id: TransactionId,
  accountId: AccountId,
  postedAt: Schema.Number,
  amount: Money,
  payee: Schema.String,
  memo: Schema.NullOr(Schema.String),
  importHash: Schema.NullOr(Schema.String),
  at: Schema.Number,
})
export type TransactionImported = Schema.Schema.Type<typeof TransactionImported>

export const TransactionCategorized = Schema.TaggedStruct("TransactionCategorized", {
  id: TransactionId,
  categoryId: Schema.NullOr(CategoryId),
  at: Schema.Number,
})
export type TransactionCategorized = Schema.Schema.Type<typeof TransactionCategorized>

export const TransactionEdited = Schema.TaggedStruct("TransactionEdited", {
  id: TransactionId,
  postedAt: Schema.UndefinedOr(Schema.Number),
  amount: Schema.UndefinedOr(Money),
  payee: Schema.UndefinedOr(Schema.String),
  memo: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
  at: Schema.Number,
})
export type TransactionEdited = Schema.Schema.Type<typeof TransactionEdited>

export const TransactionDeleted = Schema.TaggedStruct("TransactionDeleted", {
  id: TransactionId,
  at: Schema.Number,
})
export type TransactionDeleted = Schema.Schema.Type<typeof TransactionDeleted>

/**
 * Records that a Worth account is the canonical destination for transactions
 * imported from a given external source key (e.g. `"ofx:026009593:1234567890"`).
 * Lets repeat OFX/QFX imports auto-route to the right account.
 */
export const AccountExternalKeyLinked = Schema.TaggedStruct("AccountExternalKeyLinked", {
  id: AccountId,
  externalKey: Schema.String,
  at: Schema.Number,
})
export type AccountExternalKeyLinked = Schema.Schema.Type<typeof AccountExternalKeyLinked>

/**
 * The user looked at a duplicate cluster and confirmed the transactions are
 * NOT duplicates of each other. `memberIds` is the canonical-sorted list of
 * transaction ids that formed the cluster at dismissal time. When any of
 * those ids leave the projection (e.g. later deleted) or a new id joins the
 * cluster via fuzzy matching, the dismissal no longer applies and the cluster
 * resurfaces — better than pretending the prior judgment extends to the new
 * composition.
 */
export const DuplicateGroupDismissed = Schema.TaggedStruct("DuplicateGroupDismissed", {
  memberIds: Schema.Array(TransactionId),
  at: Schema.Number,
})
export type DuplicateGroupDismissed = Schema.Schema.Type<typeof DuplicateGroupDismissed>

// -- Investment events ------------------------------------------------------

export const InstrumentCreated = Schema.TaggedStruct("InstrumentCreated", {
  id: InstrumentId,
  symbol: Schema.String,
  name: Schema.String,
  kind: InstrumentKind,
  currency: CurrencyCode,
  at: Schema.Number,
})
export type InstrumentCreated = Schema.Schema.Type<typeof InstrumentCreated>

export const InvestmentAccountCreated = Schema.TaggedStruct("InvestmentAccountCreated", {
  id: InvestmentAccountId,
  name: Schema.String,
  institution: Schema.NullOr(Schema.String),
  currency: CurrencyCode,
  at: Schema.Number,
})
export type InvestmentAccountCreated = Schema.Schema.Type<typeof InvestmentAccountCreated>

export const InvestmentAccountRenamed = Schema.TaggedStruct("InvestmentAccountRenamed", {
  id: InvestmentAccountId,
  name: Schema.String,
})
export type InvestmentAccountRenamed = Schema.Schema.Type<typeof InvestmentAccountRenamed>

export const InvestmentAccountArchived = Schema.TaggedStruct("InvestmentAccountArchived", {
  id: InvestmentAccountId,
  at: Schema.Number,
})
export type InvestmentAccountArchived = Schema.Schema.Type<typeof InvestmentAccountArchived>

/**
 * Links an external data source (e.g. an OFX investment statement's
 * BROKERID+ACCTID pair) to a Worth investment account. Mirrors
 * {@link AccountExternalKeyLinked} but targets investment accounts so OFX
 * investment imports auto-route on repeat. The `ofx-inv:` prefix keeps its
 * keyspace distinct from `ofx:` (banking).
 */
export const InvestmentAccountExternalKeyLinked = Schema.TaggedStruct(
  "InvestmentAccountExternalKeyLinked",
  {
    id: InvestmentAccountId,
    externalKey: Schema.String,
    at: Schema.Number,
  },
)
export type InvestmentAccountExternalKeyLinked = Schema.Schema.Type<
  typeof InvestmentAccountExternalKeyLinked
>

/**
 * A purchase. Creates a fresh lot with `remainingQuantity = quantity` and
 * `remainingCostBasis = total` (i.e. `quantity*price + fees`). The id is
 * shared with the lot so later sells can reference a specific buy.
 */
export const InvestmentBuyRecorded = Schema.TaggedStruct("InvestmentBuyRecorded", {
  id: InvestmentTransactionId,
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  postedAt: Schema.Number,
  quantity: Quantity,
  pricePerShare: Money,
  fees: Money,
  total: Money, // signed cash impact; negative for a buy
  at: Schema.Number,
})
export type InvestmentBuyRecorded = Schema.Schema.Type<typeof InvestmentBuyRecorded>

/**
 * A sale. Consumes lots FIFO (by `openedAt`, then lot id) at apply time.
 * `total` is the signed cash impact (positive for sell proceeds net of fees).
 */
export const InvestmentSellRecorded = Schema.TaggedStruct("InvestmentSellRecorded", {
  id: InvestmentTransactionId,
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  postedAt: Schema.Number,
  quantity: Quantity,
  pricePerShare: Money,
  fees: Money,
  total: Money,
  at: Schema.Number,
})
export type InvestmentSellRecorded = Schema.Schema.Type<typeof InvestmentSellRecorded>

export const InvestmentDividendRecorded = Schema.TaggedStruct("InvestmentDividendRecorded", {
  id: InvestmentTransactionId,
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  postedAt: Schema.Number,
  amount: Money,
  at: Schema.Number,
})
export type InvestmentDividendRecorded = Schema.Schema.Type<typeof InvestmentDividendRecorded>

/**
 * A stock split. Multiplies every open lot's quantity by `numerator/denominator`
 * at apply time. Cost basis is preserved; post-split per-share basis falls.
 */
export const InvestmentSplitRecorded = Schema.TaggedStruct("InvestmentSplitRecorded", {
  id: InvestmentTransactionId,
  instrumentId: InstrumentId,
  postedAt: Schema.Number,
  numerator: Schema.Int,
  denominator: Schema.Int,
  at: Schema.Number,
})
export type InvestmentSplitRecorded = Schema.Schema.Type<typeof InvestmentSplitRecorded>

/**
 * Non-trade cash movement inside an investment account — deposits, fees,
 * interest, RSU tax journaling, etc. `amount` is signed from the account's
 * perspective: positive = cash in, negative = cash out. `kind` narrows the
 * intent for display; projections should not infer sign from kind because
 * some kinds (transfer, other) can go either direction.
 */
export const InvestmentCashFlowRecorded = Schema.TaggedStruct(
  "InvestmentCashFlowRecorded",
  {
    id: InvestmentTransactionId, // shared keyspace — projects to the same table
    accountId: InvestmentAccountId,
    postedAt: Schema.Number,
    kind: CashFlowKind,
    amount: Money,
    memo: Schema.NullOr(Schema.String),
    at: Schema.Number,
  },
)
export type InvestmentCashFlowRecorded = Schema.Schema.Type<
  typeof InvestmentCashFlowRecorded
>

export const PriceQuoteRecorded = Schema.TaggedStruct("PriceQuoteRecorded", {
  instrumentId: InstrumentId,
  asOf: Schema.Number,
  price: Money,
  at: Schema.Number,
})
export type PriceQuoteRecorded = Schema.Schema.Type<typeof PriceQuoteRecorded>

// -- Event union ------------------------------------------------------------

export const DomainEvent = Schema.Union([
  AccountCreated,
  AccountRenamed,
  AccountArchived,
  AccountExternalKeyLinked,
  CategoryCreated,
  TransactionImported,
  TransactionCategorized,
  TransactionEdited,
  TransactionDeleted,
  DuplicateGroupDismissed,
  InstrumentCreated,
  InvestmentAccountCreated,
  InvestmentAccountRenamed,
  InvestmentAccountArchived,
  InvestmentAccountExternalKeyLinked,
  InvestmentBuyRecorded,
  InvestmentSellRecorded,
  InvestmentDividendRecorded,
  InvestmentSplitRecorded,
  InvestmentCashFlowRecorded,
  PriceQuoteRecorded,
])
export type DomainEvent = Schema.Schema.Type<typeof DomainEvent>
export type DomainEventTag = DomainEvent["_tag"]
