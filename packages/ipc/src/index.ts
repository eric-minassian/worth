import { Schema } from "effect"
import {
  Account,
  AccountId,
  AccountType,
  Category,
  CategoryId,
  CurrencyCode,
  Money,
  Transaction,
  TransactionId,
} from "@worth/domain"

/**
 * Channel name used for the single generic RPC bridge between renderer and main.
 * Over HTTP in the future, this becomes the `/rpc` endpoint.
 */
export const RPC_CHANNEL = "worth:rpc"

// -- Command registry -------------------------------------------------------

export interface CommandDef<
  K extends string,
  In extends Schema.Top,
  Out extends Schema.Top,
> {
  readonly kind: K
  readonly input: In
  readonly output: Out
}

const defineCommand = <K extends string, In extends Schema.Top, Out extends Schema.Top>(
  kind: K,
  input: In,
  output: Out,
): CommandDef<K, In, Out> => ({ kind, input, output })

// -- Health / smoke ---------------------------------------------------------

export const PingCommand = defineCommand(
  "ping",
  Schema.Struct({ message: Schema.String }),
  Schema.Struct({ message: Schema.String, at: Schema.String }),
)

// -- Account commands -------------------------------------------------------

export const AccountCreateCommand = defineCommand(
  "account.create",
  Schema.Struct({
    name: Schema.String,
    type: AccountType,
    currency: CurrencyCode,
  }),
  Account,
)

export const AccountListCommand = defineCommand(
  "account.list",
  Schema.Struct({}),
  Schema.Array(Account),
)

export const AccountRenameCommand = defineCommand(
  "account.rename",
  Schema.Struct({ id: AccountId, name: Schema.String }),
  Schema.Void,
)

export const AccountArchiveCommand = defineCommand(
  "account.archive",
  Schema.Struct({ id: AccountId }),
  Schema.Void,
)

// -- Category commands ------------------------------------------------------

export const CategoryCreateCommand = defineCommand(
  "category.create",
  Schema.Struct({
    name: Schema.String,
    parentId: Schema.NullOr(CategoryId),
    color: Schema.NullOr(Schema.String),
  }),
  Category,
)

export const CategoryListCommand = defineCommand(
  "category.list",
  Schema.Struct({}),
  Schema.Array(Category),
)

// -- Transaction commands ---------------------------------------------------

export const TransactionCreateCommand = defineCommand(
  "transaction.create",
  Schema.Struct({
    accountId: AccountId,
    postedAt: Schema.Number,
    amount: Money,
    payee: Schema.String,
    memo: Schema.NullOr(Schema.String),
  }),
  Transaction,
)

export const TransactionListCommand = defineCommand(
  "transaction.list",
  Schema.Struct({
    accountId: Schema.UndefinedOr(AccountId),
    search: Schema.UndefinedOr(Schema.String),
    limit: Schema.UndefinedOr(Schema.Number),
    order: Schema.UndefinedOr(Schema.Literals(["posted-asc", "posted-desc"])),
  }),
  Schema.Array(Transaction),
)

export const TransactionCategorizeCommand = defineCommand(
  "transaction.categorize",
  Schema.Struct({ id: TransactionId, categoryId: Schema.NullOr(CategoryId) }),
  Schema.Void,
)

export const TransactionEditCommand = defineCommand(
  "transaction.edit",
  Schema.Struct({
    id: TransactionId,
    postedAt: Schema.UndefinedOr(Schema.Number),
    amount: Schema.UndefinedOr(Money),
    payee: Schema.UndefinedOr(Schema.String),
    memo: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
  }),
  Schema.Void,
)

export const TransactionDeleteCommand = defineCommand(
  "transaction.delete",
  Schema.Struct({ id: TransactionId }),
  Schema.Void,
)

// -- Registry ---------------------------------------------------------------

export const Commands = {
  ping: PingCommand,
  "account.create": AccountCreateCommand,
  "account.list": AccountListCommand,
  "account.rename": AccountRenameCommand,
  "account.archive": AccountArchiveCommand,
  "category.create": CategoryCreateCommand,
  "category.list": CategoryListCommand,
  "transaction.create": TransactionCreateCommand,
  "transaction.list": TransactionListCommand,
  "transaction.categorize": TransactionCategorizeCommand,
  "transaction.edit": TransactionEditCommand,
  "transaction.delete": TransactionDeleteCommand,
} as const

export type Commands = typeof Commands
export type CommandKind = keyof Commands
export type InputOf<K extends CommandKind> = Schema.Schema.Type<Commands[K]["input"]>
export type OutputOf<K extends CommandKind> = Schema.Schema.Type<Commands[K]["output"]>

// -- Wire envelopes ---------------------------------------------------------

export const RpcRequestEnvelope = Schema.Struct({
  kind: Schema.String,
  input: Schema.Unknown,
})
export type RpcRequestEnvelope = Schema.Schema.Type<typeof RpcRequestEnvelope>

export const RpcError = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String,
})
export type RpcError = Schema.Schema.Type<typeof RpcError>

export const RpcResponseEnvelope = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ ok: Schema.Literal(false), error: RpcError }),
])
export type RpcResponseEnvelope = Schema.Schema.Type<typeof RpcResponseEnvelope>

/**
 * Shape exposed on `window.worth` by the Electron preload script. Identical
 * over-the-wire shape will be served by the future self-hosted HTTP server.
 */
export interface WorthApi {
  readonly rpc: (message: RpcRequestEnvelope) => Promise<RpcResponseEnvelope>
}
