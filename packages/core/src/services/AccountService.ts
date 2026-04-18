import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import {
  type Account,
  type AccountId,
  type AccountType,
  type CurrencyCode,
  NotFound,
} from "@worth/domain"
import { newAccountId } from "@worth/sync"
import { EventLog } from "../EventLog"

export interface CreateAccountInput {
  readonly name: string
  readonly type: AccountType
  readonly currency: CurrencyCode
}

export interface RenameAccountInput {
  readonly id: AccountId
  readonly name: string
}

export interface LinkExternalKeyInput {
  readonly accountId: AccountId
  readonly externalKey: string
}

export class AccountService extends Context.Service<
  AccountService,
  {
    readonly create: (input: CreateAccountInput) => Effect.Effect<Account>
    readonly list: Effect.Effect<readonly Account[]>
    readonly get: (id: AccountId) => Effect.Effect<Account, NotFound>
    readonly rename: (input: RenameAccountInput) => Effect.Effect<void, NotFound>
    readonly archive: (id: AccountId) => Effect.Effect<void, NotFound>
    readonly findByExternalKey: (key: string) => Effect.Effect<Account | null>
    readonly linkExternalKey: (input: LinkExternalKeyInput) => Effect.Effect<void, NotFound>
  }
>()("@worth/core/AccountService") {}

const rowToAccount = (row: typeof schema.accounts.$inferSelect): Account => ({
  id: row.id as AccountId,
  name: row.name,
  type: row.type as AccountType,
  currency: row.currency as CurrencyCode,
  createdAt: row.createdAt,
  archivedAt: row.archivedAt,
})

export const AccountServiceLive = Layer.effect(AccountService)(
  Effect.gen(function* () {
    const db = yield* Db
    const log = yield* EventLog

    const selectById = (id: AccountId): Account | null => {
      const row = db.drizzle
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, id))
        .get()
      return row ? rowToAccount(row) : null
    }

    const create = (input: CreateAccountInput): Effect.Effect<Account> =>
      Effect.gen(function* () {
        const id = newAccountId()
        const at = Date.now()
        yield* log.append({
          _tag: "AccountCreated",
          id,
          name: input.name,
          type: input.type,
          currency: input.currency,
          at,
        })
        return {
          id,
          name: input.name,
          type: input.type,
          currency: input.currency,
          createdAt: at,
          archivedAt: null,
        }
      })

    const list = Effect.sync(() => {
      const rows = db.drizzle
        .select()
        .from(schema.accounts)
        .orderBy(asc(schema.accounts.createdAt))
        .all()
      return rows.map(rowToAccount)
    })

    const get = (id: AccountId): Effect.Effect<Account, NotFound> =>
      Effect.gen(function* () {
        const account = selectById(id)
        if (!account) return yield* Effect.fail(new NotFound({ entity: "Account", id }))
        return account
      })

    const rename = (input: RenameAccountInput): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!selectById(input.id))
          return yield* Effect.fail(new NotFound({ entity: "Account", id: input.id }))
        yield* log.append({ _tag: "AccountRenamed", id: input.id, name: input.name })
      })

    const archive = (id: AccountId): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!selectById(id)) return yield* Effect.fail(new NotFound({ entity: "Account", id }))
        yield* log.append({ _tag: "AccountArchived", id, at: Date.now() })
      })

    const findByExternalKey = (key: string): Effect.Effect<Account | null> =>
      Effect.sync(() => {
        const row = db.drizzle
          .select({ accountId: schema.accountExternalKeys.accountId })
          .from(schema.accountExternalKeys)
          .where(eq(schema.accountExternalKeys.externalKey, key))
          .get()
        if (!row) return null
        return selectById(row.accountId as AccountId)
      })

    const linkExternalKey = (input: LinkExternalKeyInput): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!selectById(input.accountId))
          return yield* Effect.fail(new NotFound({ entity: "Account", id: input.accountId }))
        yield* log.append({
          _tag: "AccountExternalKeyLinked",
          id: input.accountId,
          externalKey: input.externalKey,
          at: Date.now(),
        })
      })

    return { create, list, get, rename, archive, findByExternalKey, linkExternalKey }
  }),
)
