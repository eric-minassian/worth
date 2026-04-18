import { asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import {
  type CurrencyCode,
  type Holding,
  type InstrumentId,
  type InvestmentAccount,
  type InvestmentAccountId,
  type InvestmentCashBalance,
  NotFound,
  type Quantity,
} from "@worth/domain"
import { newInvestmentAccountId } from "@worth/sync"
import { EventLog } from "../EventLog"

export interface CreateInvestmentAccountInput {
  readonly name: string
  readonly institution: string | null
  readonly currency: CurrencyCode
}

export interface RenameInvestmentAccountInput {
  readonly id: InvestmentAccountId
  readonly name: string
}

export interface LinkInvestmentExternalKeyInput {
  readonly accountId: InvestmentAccountId
  readonly externalKey: string
}

export class InvestmentAccountService extends Context.Service<
  InvestmentAccountService,
  {
    readonly create: (
      input: CreateInvestmentAccountInput,
    ) => Effect.Effect<InvestmentAccount>
    readonly list: Effect.Effect<readonly InvestmentAccount[]>
    readonly get: (id: InvestmentAccountId) => Effect.Effect<InvestmentAccount, NotFound>
    readonly rename: (input: RenameInvestmentAccountInput) => Effect.Effect<void, NotFound>
    readonly archive: (id: InvestmentAccountId) => Effect.Effect<void, NotFound>
    readonly listHoldings: (
      accountId?: InvestmentAccountId | undefined,
    ) => Effect.Effect<readonly Holding[]>
    readonly listCashBalances: (
      accountId?: InvestmentAccountId | undefined,
    ) => Effect.Effect<readonly InvestmentCashBalance[]>
    readonly findByExternalKey: (
      key: string,
    ) => Effect.Effect<InvestmentAccount | null>
    readonly linkExternalKey: (
      input: LinkInvestmentExternalKeyInput,
    ) => Effect.Effect<void, NotFound>
  }
>()("@worth/core/InvestmentAccountService") {}

const rowToAccount = (
  row: typeof schema.investmentAccounts.$inferSelect,
): InvestmentAccount => ({
  id: row.id as InvestmentAccountId,
  name: row.name,
  institution: row.institution,
  currency: row.currency as CurrencyCode,
  createdAt: row.createdAt,
  archivedAt: row.archivedAt,
})

const rowToHolding = (row: typeof schema.holdings.$inferSelect): Holding => ({
  accountId: row.accountId as InvestmentAccountId,
  instrumentId: row.instrumentId as InstrumentId,
  quantity: BigInt(row.quantity) as Quantity,
  costBasis: {
    minor: BigInt(row.costBasisMinor),
    currency: row.currency as CurrencyCode,
  },
})

export const InvestmentAccountServiceLive = Layer.effect(InvestmentAccountService)(
  Effect.gen(function* () {
    const db = yield* Db
    const log = yield* EventLog

    const selectById = (id: InvestmentAccountId): InvestmentAccount | null => {
      const row = db.drizzle
        .select()
        .from(schema.investmentAccounts)
        .where(eq(schema.investmentAccounts.id, id))
        .get()
      return row ? rowToAccount(row) : null
    }

    const create = (
      input: CreateInvestmentAccountInput,
    ): Effect.Effect<InvestmentAccount> =>
      Effect.gen(function* () {
        const id = newInvestmentAccountId()
        const at = Date.now()
        yield* log.append({
          _tag: "InvestmentAccountCreated",
          id,
          name: input.name,
          institution: input.institution,
          currency: input.currency,
          at,
        })
        return {
          id,
          name: input.name,
          institution: input.institution,
          currency: input.currency,
          createdAt: at,
          archivedAt: null,
        }
      })

    const list = Effect.sync(() => {
      const rows = db.drizzle
        .select()
        .from(schema.investmentAccounts)
        .orderBy(asc(schema.investmentAccounts.createdAt))
        .all()
      return rows.map(rowToAccount)
    })

    const get = (
      id: InvestmentAccountId,
    ): Effect.Effect<InvestmentAccount, NotFound> =>
      Effect.gen(function* () {
        const account = selectById(id)
        if (!account)
          return yield* Effect.fail(new NotFound({ entity: "InvestmentAccount", id }))
        return account
      })

    const rename = (
      input: RenameInvestmentAccountInput,
    ): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!selectById(input.id))
          return yield* Effect.fail(
            new NotFound({ entity: "InvestmentAccount", id: input.id }),
          )
        yield* log.append({
          _tag: "InvestmentAccountRenamed",
          id: input.id,
          name: input.name,
        })
      })

    const archive = (id: InvestmentAccountId): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!selectById(id))
          return yield* Effect.fail(new NotFound({ entity: "InvestmentAccount", id }))
        yield* log.append({ _tag: "InvestmentAccountArchived", id, at: Date.now() })
      })

    const listHoldings = (
      accountId?: InvestmentAccountId | undefined,
    ): Effect.Effect<readonly Holding[]> =>
      Effect.sync(() => {
        const base = db.drizzle.select().from(schema.holdings)
        const filtered =
          accountId !== undefined
            ? base.where(eq(schema.holdings.accountId, accountId))
            : base
        return filtered.all().map(rowToHolding)
      })

    /**
     * Sum every investment_transactions row's amount_minor by (accountId,
     * currency). Buys carry negative amounts (cash out), sells + dividends
     * + deposits + interest carry positive — so the straight sum yields
     * the net cash position. Splits have amount=0 and don't affect it.
     */
    const listCashBalances = (
      accountId?: InvestmentAccountId | undefined,
    ): Effect.Effect<readonly InvestmentCashBalance[]> =>
      Effect.sync(() => {
        const base = db.drizzle
          .select({
            accountId: schema.investmentTransactions.accountId,
            currency: schema.investmentTransactions.currency,
            sum: sql<number>`sum(${schema.investmentTransactions.amountMinor})`,
          })
          .from(schema.investmentTransactions)
        const filtered =
          accountId !== undefined
            ? base.where(eq(schema.investmentTransactions.accountId, accountId))
            : base
        const rows = filtered
          .groupBy(
            schema.investmentTransactions.accountId,
            schema.investmentTransactions.currency,
          )
          .all()
        return rows.map((r) => ({
          accountId: r.accountId as InvestmentAccountId,
          currency: r.currency as CurrencyCode,
          minor: BigInt(r.sum ?? 0),
        }))
      })

    const findByExternalKey = (key: string): Effect.Effect<InvestmentAccount | null> =>
      Effect.sync(() => {
        const row = db.drizzle
          .select({ accountId: schema.investmentAccountExternalKeys.accountId })
          .from(schema.investmentAccountExternalKeys)
          .where(eq(schema.investmentAccountExternalKeys.externalKey, key))
          .get()
        if (!row) return null
        return selectById(row.accountId as InvestmentAccountId)
      })

    const linkExternalKey = (
      input: LinkInvestmentExternalKeyInput,
    ): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!selectById(input.accountId))
          return yield* Effect.fail(
            new NotFound({ entity: "InvestmentAccount", id: input.accountId }),
          )
        yield* log.append({
          _tag: "InvestmentAccountExternalKeyLinked",
          id: input.accountId,
          externalKey: input.externalKey,
          at: Date.now(),
        })
      })

    return {
      create,
      list,
      get,
      rename,
      archive,
      listHoldings,
      listCashBalances,
      findByExternalKey,
      linkExternalKey,
    }
  }),
)
