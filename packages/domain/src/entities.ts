import { Schema } from "effect"
import { AccountId, CategoryId, CurrencyCode, Money, TransactionId } from "./primitives"

// -- Account ----------------------------------------------------------------

export const AccountType = Schema.Literals(["checking", "savings", "credit", "cash", "other"])
export type AccountType = Schema.Schema.Type<typeof AccountType>

export const Account = Schema.Struct({
  id: AccountId,
  name: Schema.String,
  type: AccountType,
  currency: CurrencyCode,
  createdAt: Schema.Number,
  archivedAt: Schema.NullOr(Schema.Number),
})
export type Account = Schema.Schema.Type<typeof Account>

// -- Category ---------------------------------------------------------------

export const Category = Schema.Struct({
  id: CategoryId,
  name: Schema.String,
  parentId: Schema.NullOr(CategoryId),
  color: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
})
export type Category = Schema.Schema.Type<typeof Category>

// -- Transaction ------------------------------------------------------------

export const Transaction = Schema.Struct({
  id: TransactionId,
  accountId: AccountId,
  postedAt: Schema.Number,
  amount: Money,
  payee: Schema.String,
  memo: Schema.NullOr(Schema.String),
  categoryId: Schema.NullOr(CategoryId),
  importHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Transaction = Schema.Schema.Type<typeof Transaction>
