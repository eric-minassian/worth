import { and, asc, desc, eq, like, or } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import {
  type AccountId,
  type CategoryId,
  type CurrencyCode,
  type Money,
  NotFound,
  type Transaction,
  type TransactionId,
} from "@worth/domain"
import { newTransactionId } from "@worth/sync"
import { EventLog } from "../EventLog"

export interface CreateTransactionInput {
  readonly accountId: AccountId
  readonly postedAt: number
  readonly amount: Money
  readonly payee: string
  readonly memo: string | null
  readonly importHash?: string | null
}

export interface EditTransactionInput {
  readonly id: TransactionId
  readonly postedAt?: number | undefined
  readonly amount?: Money | undefined
  readonly payee?: string | undefined
  readonly memo?: string | null | undefined
}

export interface CategorizeInput {
  readonly id: TransactionId
  readonly categoryId: CategoryId | null
}

export interface ListTransactionsQuery {
  readonly accountId?: AccountId | undefined
  readonly search?: string | undefined
  readonly limit?: number | undefined
  readonly order?: "posted-asc" | "posted-desc" | undefined
}

export class TransactionService extends Context.Service<
  TransactionService,
  {
    readonly create: (input: CreateTransactionInput) => Effect.Effect<Transaction>
    readonly list: (query: ListTransactionsQuery) => Effect.Effect<readonly Transaction[]>
    readonly categorize: (input: CategorizeInput) => Effect.Effect<void, NotFound>
    readonly edit: (input: EditTransactionInput) => Effect.Effect<void, NotFound>
    readonly delete: (id: TransactionId) => Effect.Effect<void, NotFound>
  }
>()("@worth/core/TransactionService") {}

const rowToTransaction = (
  row: typeof schema.transactions.$inferSelect,
): Transaction => ({
  id: row.id as TransactionId,
  accountId: row.accountId as AccountId,
  postedAt: row.postedAt,
  amount: {
    minor: BigInt(row.amountMinor),
    currency: row.currency as CurrencyCode,
  },
  payee: row.payee,
  memo: row.memo,
  categoryId: (row.categoryId ?? null) as CategoryId | null,
  importHash: row.importHash,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const TransactionServiceLive = Layer.effect(TransactionService)(
  Effect.gen(function* () {
    const db = yield* Db
    const log = yield* EventLog

    const exists = (id: TransactionId): boolean =>
      db.drizzle
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(eq(schema.transactions.id, id))
        .get() !== undefined

    const create = (input: CreateTransactionInput): Effect.Effect<Transaction> =>
      Effect.gen(function* () {
        const id = newTransactionId()
        const at = Date.now()
        yield* log.append({
          _tag: "TransactionImported",
          id,
          accountId: input.accountId,
          postedAt: input.postedAt,
          amount: input.amount,
          payee: input.payee,
          memo: input.memo,
          importHash: input.importHash ?? null,
          at,
        })
        return {
          id,
          accountId: input.accountId,
          postedAt: input.postedAt,
          amount: input.amount,
          payee: input.payee,
          memo: input.memo,
          categoryId: null,
          importHash: input.importHash ?? null,
          createdAt: at,
          updatedAt: at,
        }
      })

    const list = (query: ListTransactionsQuery): Effect.Effect<readonly Transaction[]> =>
      Effect.sync(() => {
        const conditions = []
        if (query.accountId !== undefined) {
          conditions.push(eq(schema.transactions.accountId, query.accountId))
        }
        if (query.search !== undefined && query.search.length > 0) {
          const term = `%${query.search}%`
          conditions.push(
            or(like(schema.transactions.payee, term), like(schema.transactions.memo, term)),
          )
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined
        const orderBy =
          query.order === "posted-asc"
            ? asc(schema.transactions.postedAt)
            : desc(schema.transactions.postedAt)

        const base = db.drizzle.select().from(schema.transactions)
        const filtered = whereClause ? base.where(whereClause) : base
        const ordered = filtered.orderBy(orderBy)
        const limited =
          query.limit !== undefined && query.limit > 0 ? ordered.limit(query.limit) : ordered

        return limited.all().map(rowToTransaction)
      })

    const categorize = (input: CategorizeInput): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!exists(input.id))
          return yield* Effect.fail(new NotFound({ entity: "Transaction", id: input.id }))
        yield* log.append({
          _tag: "TransactionCategorized",
          id: input.id,
          categoryId: input.categoryId,
        })
      })

    const edit = (input: EditTransactionInput): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!exists(input.id))
          return yield* Effect.fail(new NotFound({ entity: "Transaction", id: input.id }))
        yield* log.append({
          _tag: "TransactionEdited",
          id: input.id,
          postedAt: input.postedAt,
          amount: input.amount,
          payee: input.payee,
          memo: input.memo,
          at: Date.now(),
        })
      })

    const remove = (id: TransactionId): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!exists(id)) return yield* Effect.fail(new NotFound({ entity: "Transaction", id }))
        yield* log.append({ _tag: "TransactionDeleted", id, at: Date.now() })
      })

    return { create, list, categorize, edit, delete: remove }
  }),
)
