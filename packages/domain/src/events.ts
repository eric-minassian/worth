import { Schema } from "effect"
import { AccountType } from "./entities"
import { AccountId, CategoryId, CurrencyCode, Money, TransactionId } from "./primitives"

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

// -- Event union ------------------------------------------------------------

export const DomainEvent = Schema.Union([
  AccountCreated,
  AccountRenamed,
  AccountArchived,
  CategoryCreated,
  TransactionImported,
  TransactionCategorized,
  TransactionEdited,
  TransactionDeleted,
])
export type DomainEvent = Schema.Schema.Type<typeof DomainEvent>
export type DomainEventTag = DomainEvent["_tag"]
