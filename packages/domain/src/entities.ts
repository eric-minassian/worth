import { Schema } from "effect"
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

// -- Investments ------------------------------------------------------------

export const InstrumentKind = Schema.Literals([
  "stock",
  "etf",
  "mutual_fund",
  "bond",
  "crypto",
  "cash",
  "other",
])
export type InstrumentKind = Schema.Schema.Type<typeof InstrumentKind>

export const Instrument = Schema.Struct({
  id: InstrumentId,
  symbol: Schema.String,
  name: Schema.String,
  kind: InstrumentKind,
  currency: CurrencyCode,
  createdAt: Schema.Number,
})
export type Instrument = Schema.Schema.Type<typeof Instrument>

export const InvestmentAccount = Schema.Struct({
  id: InvestmentAccountId,
  name: Schema.String,
  institution: Schema.NullOr(Schema.String),
  currency: CurrencyCode,
  createdAt: Schema.Number,
  archivedAt: Schema.NullOr(Schema.Number),
})
export type InvestmentAccount = Schema.Schema.Type<typeof InvestmentAccount>

/**
 * A tax lot: one purchase of an instrument in an account. Created by a buy
 * event. `remainingQuantity` is consumed FIFO by subsequent sells; when it
 * reaches zero the lot is closed but the row stays for cost-basis history.
 */
export const Lot = Schema.Struct({
  id: InvestmentTransactionId, // shares id with its originating buy
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  openedAt: Schema.Number,
  originalQuantity: Quantity,
  remainingQuantity: Quantity,
  originalCostBasis: Money,
  remainingCostBasis: Money,
})
export type Lot = Schema.Schema.Type<typeof Lot>

/**
 * Summary across lots for a given (account, instrument). Derived from lots;
 * present as its own projection so the UI doesn't re-aggregate on every read.
 */
export const Holding = Schema.Struct({
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  quantity: Quantity,
  costBasis: Money,
})
export type Holding = Schema.Schema.Type<typeof Holding>

export const InvestmentTransactionKind = Schema.Literals([
  "buy",
  "sell",
  "dividend",
  "split",
  "deposit",
  "withdrawal",
  "interest",
  "fee",
  "transfer",
  "tax",
  "other",
])
export type InvestmentTransactionKind = Schema.Schema.Type<typeof InvestmentTransactionKind>

/**
 * A non-trade cash movement in an investment account — deposits, fees,
 * interest credits, tax withholding journaled from payroll, etc. The set
 * of kinds is the same as {@link InvestmentTransactionKind} minus the
 * instrument-touching ones (buy/sell/dividend/split).
 */
export const CashFlowKind = Schema.Literals([
  "deposit",
  "withdrawal",
  "interest",
  "fee",
  "transfer",
  "tax",
  "other",
])
export type CashFlowKind = Schema.Schema.Type<typeof CashFlowKind>

/**
 * A display-layer record of every investment event applied to an account. Buy
 * and sell carry quantity + price-per-share; dividend carries amount only;
 * split carries the ratio. Cash impact (`amount`) is the signed cash the
 * account saw — negative for buys/fees, positive for sells/dividends, zero
 * for splits.
 */
export const InvestmentTransaction = Schema.Struct({
  id: InvestmentTransactionId,
  accountId: InvestmentAccountId,
  instrumentId: Schema.NullOr(InstrumentId),
  kind: InvestmentTransactionKind,
  postedAt: Schema.Number,
  quantity: Schema.NullOr(Quantity),
  pricePerShare: Schema.NullOr(Money),
  fees: Schema.NullOr(Money),
  amount: Money,
  memo: Schema.NullOr(Schema.String),
  splitNumerator: Schema.NullOr(Schema.Number),
  splitDenominator: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
})
export type InvestmentTransaction = Schema.Schema.Type<typeof InvestmentTransaction>

/**
 * Cash balance per (investmentAccount, currency) — the net of every signed
 * cash movement on the account (deposits + sells + dividends − buys −
 * withdrawals − fees). Derived from `investment_transactions`; no storage.
 */
export const InvestmentCashBalance = Schema.Struct({
  accountId: InvestmentAccountId,
  currency: CurrencyCode,
  minor: Schema.BigIntFromString,
})
export type InvestmentCashBalance = Schema.Schema.Type<typeof InvestmentCashBalance>

export const PriceQuote = Schema.Struct({
  instrumentId: InstrumentId,
  asOf: Schema.Number,
  price: Money,
  recordedAt: Schema.Number,
})
export type PriceQuote = Schema.Schema.Type<typeof PriceQuote>
