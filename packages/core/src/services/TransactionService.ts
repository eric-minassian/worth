import { and, asc, desc, eq, like, or, sql } from "drizzle-orm"
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

/**
 * A set of transactions that share the same (account, posted-day, amount,
 * currency) fingerprint. Size >= 2 by construction. Members are ordered by
 * `createdAt` ascending — the earliest is typically the original, and the
 * UI may default to keeping it.
 */
export interface DuplicateGroup {
  readonly accountId: AccountId
  readonly postedAt: number
  readonly amount: Money
  readonly members: readonly Transaction[]
}

export interface ListDuplicateGroupsQuery {
  readonly accountId?: AccountId | undefined
  /**
   * ±N days around `postedAt` that still counts as the same cluster. `0`
   * reproduces exact-match behavior. Clusters form transitively: rows at
   * days 0, 3, 6 with `windowDays: 3` collapse into one group because the
   * consecutive gaps never exceed the window.
   */
  readonly windowDays?: number | undefined
}

export class TransactionService extends Context.Service<
  TransactionService,
  {
    readonly create: (input: CreateTransactionInput) => Effect.Effect<Transaction>
    readonly list: (query: ListTransactionsQuery) => Effect.Effect<readonly Transaction[]>
    readonly categorize: (input: CategorizeInput) => Effect.Effect<void, NotFound>
    readonly edit: (input: EditTransactionInput) => Effect.Effect<void, NotFound>
    readonly delete: (id: TransactionId) => Effect.Effect<void, NotFound>
    readonly deleteMany: (
      ids: readonly TransactionId[],
    ) => Effect.Effect<{ readonly deleted: number }, NotFound>
    readonly listDuplicateGroups: (
      query: ListDuplicateGroupsQuery,
    ) => Effect.Effect<readonly DuplicateGroup[]>
    readonly dismissDuplicateGroup: (
      memberIds: readonly TransactionId[],
    ) => Effect.Effect<void>
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
          at: Date.now(),
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

    const removeMany = (
      ids: readonly TransactionId[],
    ): Effect.Effect<{ deleted: number }, NotFound> =>
      Effect.gen(function* () {
        if (ids.length === 0) return { deleted: 0 }
        // Deduplicate the request so a caller passing the same id twice doesn't
        // produce two events; then fail fast on anything not in the projection.
        const unique = Array.from(new Set(ids))
        for (const id of unique) {
          if (!exists(id)) return yield* Effect.fail(new NotFound({ entity: "Transaction", id }))
        }
        const at = Date.now()
        yield* log.appendAll(
          unique.map((id) => ({ _tag: "TransactionDeleted" as const, id, at })),
        )
        return { deleted: unique.length }
      })

    const MS_PER_DAY = 86_400_000

    const emitCluster = (out: DuplicateGroup[], rows: readonly Transaction[]): void => {
      const first = rows[0]
      if (!first) return
      // Sort members by createdAt so the UI's "oldest is default keeper"
      // heuristic produces a sensible pick even after fuzzy grouping.
      const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt)
      out.push({
        accountId: first.accountId,
        postedAt: first.postedAt,
        amount: first.amount,
        members: sorted,
      })
    }

    const listDuplicateGroups = (
      query: ListDuplicateGroupsQuery,
    ): Effect.Effect<readonly DuplicateGroup[]> =>
      Effect.sync(() => {
        const t = schema.transactions
        const windowDays = Math.max(0, query.windowDays ?? 0)

        // Pull candidate rows once. A row is only a duplicate candidate if
        // another row in the same account shares its currency and amount —
        // prefilter those keys in SQL so we don't stream the full ledger.
        const candidateKeysBase = db.drizzle
          .select({
            accountId: t.accountId,
            amountMinor: t.amountMinor,
            currency: t.currency,
          })
          .from(t)
        const candidateKeysFiltered =
          query.accountId !== undefined
            ? candidateKeysBase.where(eq(t.accountId, query.accountId))
            : candidateKeysBase
        const candidateKeys = candidateKeysFiltered
          .groupBy(t.accountId, t.amountMinor, t.currency)
          .having(sql`count(*) > 1`)
          .all()

        if (candidateKeys.length === 0) return []

        // Fetch every row matching any candidate key, in one pass. Narrower
        // than a full-table scan when the ledger is large.
        const rowsByBucket = new Map<string, Transaction[]>()
        for (const k of candidateKeys) {
          const rows = db.drizzle
            .select()
            .from(t)
            .where(
              and(
                eq(t.accountId, k.accountId),
                eq(t.amountMinor, k.amountMinor),
                eq(t.currency, k.currency),
              ),
            )
            .orderBy(asc(t.postedAt), asc(t.createdAt))
            .all()
            .map(rowToTransaction)
          rowsByBucket.set(
            `${k.accountId}|${k.amountMinor}|${k.currency}`,
            rows,
          )
        }

        // Cluster by sliding window over posted_at per bucket. `windowDays: 0`
        // requires exact match (gap === 0); otherwise consecutive rows within
        // the window transitively join.
        const windowMs = windowDays * MS_PER_DAY
        const clusters: DuplicateGroup[] = []
        for (const rows of rowsByBucket.values()) {
          let current: Transaction[] = []
          for (const row of rows) {
            const prev = current[current.length - 1]
            if (!prev) {
              current.push(row)
              continue
            }
            const gap = row.postedAt - prev.postedAt
            const sameCluster = windowDays === 0 ? gap === 0 : gap <= windowMs
            if (sameCluster) {
              current.push(row)
            } else {
              if (current.length > 1) emitCluster(clusters, current)
              current = [row]
            }
          }
          if (current.length > 1) emitCluster(clusters, current)
        }

        if (clusters.length === 0) return []

        // Filter out groups the user has previously dismissed. Key comparison
        // uses canonical-sorted ids so membership changes invalidate dismissal.
        const dismissedKeys = new Set(
          db.drizzle
            .select({ key: schema.duplicateDismissals.memberKey })
            .from(schema.duplicateDismissals)
            .all()
            .map((r) => r.key),
        )
        const visible = clusters.filter((g) => {
          const key = [...g.members].map((m) => m.id).sort().join(",")
          return !dismissedKeys.has(key)
        })

        // Stable, user-friendly order: newest cluster first, by latest member.
        visible.sort((a, b) => {
          const latestA = a.members.reduce((m, x) => Math.max(m, x.postedAt), 0)
          const latestB = b.members.reduce((m, x) => Math.max(m, x.postedAt), 0)
          return latestB - latestA
        })
        return visible
      })

    const dismissDuplicateGroup = (
      memberIds: readonly TransactionId[],
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (memberIds.length < 2) return
        yield* log.append({
          _tag: "DuplicateGroupDismissed",
          memberIds,
          at: Date.now(),
        })
      })

    return {
      create,
      list,
      categorize,
      edit,
      delete: remove,
      deleteMany: removeMany,
      listDuplicateGroups,
      dismissDuplicateGroup,
    }
  }),
)
