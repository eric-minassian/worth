import { and, asc, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import {
  type CashFlowKind,
  type CurrencyCode,
  type InstrumentId,
  type InvestmentAccountId,
  type InvestmentTransaction,
  type InvestmentTransactionId,
  type InvestmentTransactionKind,
  type Money,
  NotFound,
  QUANTITY_SCALE,
  type Quantity,
} from "@worth/domain"
import { newInvestmentTransactionId } from "@worth/sync"
import { EventLog } from "../EventLog"

export interface BuyInput {
  readonly accountId: InvestmentAccountId
  readonly instrumentId: InstrumentId
  readonly postedAt: number
  readonly quantity: Quantity
  readonly pricePerShare: Money
  readonly fees?: Money | undefined
}

export interface SellInput {
  readonly accountId: InvestmentAccountId
  readonly instrumentId: InstrumentId
  readonly postedAt: number
  readonly quantity: Quantity
  readonly pricePerShare: Money
  readonly fees?: Money | undefined
}

export interface DividendInput {
  readonly accountId: InvestmentAccountId
  readonly instrumentId: InstrumentId
  readonly postedAt: number
  readonly amount: Money
}

export interface SplitInput {
  readonly instrumentId: InstrumentId
  readonly postedAt: number
  readonly numerator: number
  readonly denominator: number
}

export interface CashFlowInput {
  readonly accountId: InvestmentAccountId
  readonly postedAt: number
  readonly kind: CashFlowKind
  /** Signed from the account's perspective: positive = cash in, negative = out. */
  readonly amount: Money
  readonly memo?: string | null | undefined
}

export interface ListInvestmentTransactionsQuery {
  readonly accountId?: InvestmentAccountId | undefined
  readonly instrumentId?: InstrumentId | undefined
  readonly kind?: InvestmentTransactionKind | undefined
  readonly limit?: number | undefined
  readonly order?: "posted-asc" | "posted-desc" | undefined
}

export class InvestmentTransactionService extends Context.Service<
  InvestmentTransactionService,
  {
    readonly buy: (input: BuyInput) => Effect.Effect<InvestmentTransaction, NotFound>
    readonly sell: (input: SellInput) => Effect.Effect<InvestmentTransaction, NotFound>
    readonly dividend: (
      input: DividendInput,
    ) => Effect.Effect<InvestmentTransaction, NotFound>
    readonly split: (input: SplitInput) => Effect.Effect<void, NotFound>
    readonly recordCashFlow: (
      input: CashFlowInput,
    ) => Effect.Effect<InvestmentTransaction, NotFound>
    readonly list: (
      query: ListInvestmentTransactionsQuery,
    ) => Effect.Effect<readonly InvestmentTransaction[]>
  }
>()("@worth/core/InvestmentTransactionService") {}

const rowToInvestmentTransaction = (
  row: typeof schema.investmentTransactions.$inferSelect,
): InvestmentTransaction => {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id as InvestmentTransactionId,
    accountId: row.accountId as InvestmentAccountId,
    instrumentId: (row.instrumentId ?? null) as InstrumentId | null,
    kind: row.kind as InvestmentTransactionKind,
    postedAt: row.postedAt,
    quantity: row.quantity === null ? null : (BigInt(row.quantity) as Quantity),
    pricePerShare:
      row.pricePerShareMinor === null
        ? null
        : { minor: BigInt(row.pricePerShareMinor), currency },
    fees:
      row.feesMinor === null ? null : { minor: BigInt(row.feesMinor), currency },
    amount: { minor: BigInt(row.amountMinor), currency },
    memo: row.memo,
    splitNumerator: row.splitNumerator,
    splitDenominator: row.splitDenominator,
    createdAt: row.createdAt,
  }
}

/**
 * Computes gross = quantity × pricePerShare in minor units. Both operands are
 * bigint, and the caller scales the quantity by QUANTITY_SCALE so we divide
 * that scale back out to land in pure minor-unit integers.
 */
const grossMinor = (quantity: Quantity, pricePerShare: Money): bigint =>
  (quantity * pricePerShare.minor) / QUANTITY_SCALE

export const InvestmentTransactionServiceLive = Layer.effect(InvestmentTransactionService)(
  Effect.gen(function* () {
    const db = yield* Db
    const log = yield* EventLog

    const accountExists = (id: InvestmentAccountId): boolean =>
      db.drizzle
        .select({ id: schema.investmentAccounts.id })
        .from(schema.investmentAccounts)
        .where(eq(schema.investmentAccounts.id, id))
        .get() !== undefined

    const instrumentExists = (id: InstrumentId): boolean =>
      db.drizzle
        .select({ id: schema.instruments.id })
        .from(schema.instruments)
        .where(eq(schema.instruments.id, id))
        .get() !== undefined

    const buildRecord = (
      id: InvestmentTransactionId,
      input: { readonly accountId: InvestmentAccountId },
      kind: InvestmentTransactionKind,
      postedAt: number,
      at: number,
      instrumentId: InstrumentId | null,
      quantity: Quantity | null,
      pricePerShare: Money | null,
      fees: Money | null,
      amount: Money,
    ): InvestmentTransaction => ({
      id,
      accountId: input.accountId,
      instrumentId,
      kind,
      postedAt,
      quantity,
      pricePerShare,
      fees,
      amount,
      memo: null,
      splitNumerator: null,
      splitDenominator: null,
      createdAt: at,
    })

    const buy = (input: BuyInput): Effect.Effect<InvestmentTransaction, NotFound> =>
      Effect.gen(function* () {
        if (!accountExists(input.accountId))
          return yield* Effect.fail(
            new NotFound({ entity: "InvestmentAccount", id: input.accountId }),
          )
        if (!instrumentExists(input.instrumentId))
          return yield* Effect.fail(
            new NotFound({ entity: "Instrument", id: input.instrumentId }),
          )
        const id = newInvestmentTransactionId()
        const at = Date.now()
        const currency = input.pricePerShare.currency
        const fees = input.fees ?? { minor: 0n, currency }
        // Cash out = gross + fees; stored as negative to mean "cash left account".
        const totalMinor = -(grossMinor(input.quantity, input.pricePerShare) + fees.minor)
        const total: Money = { minor: totalMinor, currency }
        yield* log.append({
          _tag: "InvestmentBuyRecorded",
          id,
          accountId: input.accountId,
          instrumentId: input.instrumentId,
          postedAt: input.postedAt,
          quantity: input.quantity,
          pricePerShare: input.pricePerShare,
          fees,
          total,
          at,
        })
        return buildRecord(
          id,
          input,
          "buy",
          input.postedAt,
          at,
          input.instrumentId,
          input.quantity,
          input.pricePerShare,
          fees,
          total,
        )
      })

    const sell = (input: SellInput): Effect.Effect<InvestmentTransaction, NotFound> =>
      Effect.gen(function* () {
        if (!accountExists(input.accountId))
          return yield* Effect.fail(
            new NotFound({ entity: "InvestmentAccount", id: input.accountId }),
          )
        if (!instrumentExists(input.instrumentId))
          return yield* Effect.fail(
            new NotFound({ entity: "Instrument", id: input.instrumentId }),
          )
        const id = newInvestmentTransactionId()
        const at = Date.now()
        const currency = input.pricePerShare.currency
        const fees = input.fees ?? { minor: 0n, currency }
        const totalMinor = grossMinor(input.quantity, input.pricePerShare) - fees.minor
        const total: Money = { minor: totalMinor, currency }
        yield* log.append({
          _tag: "InvestmentSellRecorded",
          id,
          accountId: input.accountId,
          instrumentId: input.instrumentId,
          postedAt: input.postedAt,
          quantity: input.quantity,
          pricePerShare: input.pricePerShare,
          fees,
          total,
          at,
        })
        return buildRecord(
          id,
          input,
          "sell",
          input.postedAt,
          at,
          input.instrumentId,
          input.quantity,
          input.pricePerShare,
          fees,
          total,
        )
      })

    const dividend = (
      input: DividendInput,
    ): Effect.Effect<InvestmentTransaction, NotFound> =>
      Effect.gen(function* () {
        if (!accountExists(input.accountId))
          return yield* Effect.fail(
            new NotFound({ entity: "InvestmentAccount", id: input.accountId }),
          )
        if (!instrumentExists(input.instrumentId))
          return yield* Effect.fail(
            new NotFound({ entity: "Instrument", id: input.instrumentId }),
          )
        const id = newInvestmentTransactionId()
        const at = Date.now()
        yield* log.append({
          _tag: "InvestmentDividendRecorded",
          id,
          accountId: input.accountId,
          instrumentId: input.instrumentId,
          postedAt: input.postedAt,
          amount: input.amount,
          at,
        })
        return buildRecord(
          id,
          input,
          "dividend",
          input.postedAt,
          at,
          input.instrumentId,
          null,
          null,
          null,
          input.amount,
        )
      })

    const split = (input: SplitInput): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!instrumentExists(input.instrumentId))
          return yield* Effect.fail(
            new NotFound({ entity: "Instrument", id: input.instrumentId }),
          )
        const id = newInvestmentTransactionId()
        yield* log.append({
          _tag: "InvestmentSplitRecorded",
          id,
          instrumentId: input.instrumentId,
          postedAt: input.postedAt,
          numerator: input.numerator,
          denominator: input.denominator,
          at: Date.now(),
        })
      })

    const recordCashFlow = (
      input: CashFlowInput,
    ): Effect.Effect<InvestmentTransaction, NotFound> =>
      Effect.gen(function* () {
        if (!accountExists(input.accountId))
          return yield* Effect.fail(
            new NotFound({ entity: "InvestmentAccount", id: input.accountId }),
          )
        const id = newInvestmentTransactionId()
        const at = Date.now()
        const memo = input.memo ?? null
        yield* log.append({
          _tag: "InvestmentCashFlowRecorded",
          id,
          accountId: input.accountId,
          postedAt: input.postedAt,
          kind: input.kind,
          amount: input.amount,
          memo,
          at,
        })
        return {
          id,
          accountId: input.accountId,
          instrumentId: null,
          kind: input.kind,
          postedAt: input.postedAt,
          quantity: null,
          pricePerShare: null,
          fees: null,
          amount: input.amount,
          memo,
          splitNumerator: null,
          splitDenominator: null,
          createdAt: at,
        }
      })

    const list = (
      query: ListInvestmentTransactionsQuery,
    ): Effect.Effect<readonly InvestmentTransaction[]> =>
      Effect.sync(() => {
        const conds = []
        if (query.accountId !== undefined)
          conds.push(eq(schema.investmentTransactions.accountId, query.accountId))
        if (query.instrumentId !== undefined)
          conds.push(eq(schema.investmentTransactions.instrumentId, query.instrumentId))
        if (query.kind !== undefined)
          conds.push(eq(schema.investmentTransactions.kind, query.kind))
        const whereClause = conds.length > 0 ? and(...conds) : undefined
        const base = db.drizzle.select().from(schema.investmentTransactions)
        const filtered = whereClause ? base.where(whereClause) : base
        const ordered = filtered.orderBy(
          query.order === "posted-asc"
            ? asc(schema.investmentTransactions.postedAt)
            : desc(schema.investmentTransactions.postedAt),
        )
        const limited =
          query.limit !== undefined && query.limit > 0 ? ordered.limit(query.limit) : ordered
        return limited.all().map(rowToInvestmentTransaction)
      })

    return { buy, sell, dividend, split, recordCashFlow, list }
  }),
)
