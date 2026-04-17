import { Schema } from "effect"
import {
  Account,
  AccountId,
  AccountType,
  Category,
  CategoryId,
  CurrencyCode,
  DeviceId,
  Hlc,
  Money,
  Transaction,
  TransactionId,
} from "@worth/domain"

/**
 * Channel name used for the single generic RPC bridge between renderer and main.
 * Over HTTP in the future, this becomes the `/rpc` endpoint.
 */
export const RPC_CHANNEL = "worth:rpc"

/**
 * One-way channel for main → renderer push notifications (updater progress,
 * availability changes). Renderer subscribes via `window.worth.onUpdateEvent`.
 */
export const UPDATE_EVENT_CHANNEL = "worth:update"

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

// -- Import commands --------------------------------------------------------

const ColumnRole = Schema.Literals(["date", "payee", "amount", "memo", "skip"])
const ColumnMapping = Schema.Record(Schema.String, ColumnRole)

export const ImportPreviewCommand = defineCommand(
  "transaction.import.preview",
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({
    headers: Schema.Array(Schema.String),
    sampleRows: Schema.Array(Schema.Array(Schema.String)),
    totalRows: Schema.Number,
    suggestedMapping: ColumnMapping,
  }),
)

export const ImportCommitCommand = defineCommand(
  "transaction.import.commit",
  Schema.Struct({
    accountId: AccountId,
    text: Schema.String,
    mapping: ColumnMapping,
  }),
  Schema.Struct({
    total: Schema.Number,
    imported: Schema.Number,
    duplicates: Schema.Number,
    errors: Schema.Array(
      Schema.Struct({ rowIndex: Schema.Number, message: Schema.String }),
    ),
  }),
)

// -- System commands --------------------------------------------------------

export const SystemStatsCommand = defineCommand(
  "system.stats",
  Schema.Struct({}),
  Schema.Struct({
    deviceId: DeviceId,
    eventCount: Schema.Number,
    accountCount: Schema.Number,
    transactionCount: Schema.Number,
    categoryCount: Schema.Number,
    lastHlc: Schema.NullOr(Hlc),
  }),
)

export const SystemExportCommand = defineCommand(
  "system.export",
  Schema.Struct({}),
  Schema.Union([
    Schema.Struct({ cancelled: Schema.Literal(true) }),
    Schema.Struct({
      cancelled: Schema.Literal(false),
      path: Schema.String,
      eventCount: Schema.Number,
    }),
  ]),
)

export const SystemImportCommand = defineCommand(
  "system.import",
  Schema.Struct({}),
  Schema.Union([
    Schema.Struct({ cancelled: Schema.Literal(true) }),
    Schema.Struct({
      cancelled: Schema.Literal(false),
      path: Schema.String,
      accepted: Schema.Number,
      skipped: Schema.Number,
    }),
  ]),
)

export const SystemRebuildCommand = defineCommand(
  "system.rebuildProjections",
  Schema.Struct({}),
  Schema.Struct({ replayed: Schema.Number }),
)

// -- Vault commands ---------------------------------------------------------

/**
 * Whether the encrypted DB file exists on disk. Drives the initial unlock
 * screen: if `initialized` is false, the renderer asks the user to *set* a
 * password; otherwise it asks to *unlock* with an existing password.
 */
export const VaultStatusCommand = defineCommand(
  "vault.status",
  Schema.Struct({}),
  Schema.Struct({
    initialized: Schema.Boolean,
    unlocked: Schema.Boolean,
  }),
)

export const VaultUnlockCommand = defineCommand(
  "vault.unlock",
  Schema.Struct({ password: Schema.String }),
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true) }),
    Schema.Struct({
      ok: Schema.Literal(false),
      reason: Schema.Literals(["wrong-password", "corrupt"]),
    }),
  ]),
)

export const VaultLockCommand = defineCommand(
  "vault.lock",
  Schema.Struct({}),
  Schema.Struct({ ok: Schema.Boolean }),
)

// -- Updater commands -------------------------------------------------------

export const UpdateChannel = Schema.Literals(["stable", "nightly"])
export type UpdateChannel = Schema.Schema.Type<typeof UpdateChannel>

/**
 * Snapshot of the main-process updater's state. Worth is macOS-only and
 * unsigned — we cannot install in place, so the flow is: detect a newer
 * release on GitHub, then open the release page for a manual DMG swap.
 */
export const UpdaterState = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("idle"),
    currentVersion: Schema.String,
    channel: UpdateChannel,
    lastCheckedAt: Schema.NullOr(Schema.Number),
  }),
  Schema.Struct({
    status: Schema.Literal("checking"),
    currentVersion: Schema.String,
    channel: UpdateChannel,
  }),
  Schema.Struct({
    status: Schema.Literal("not-available"),
    currentVersion: Schema.String,
    channel: UpdateChannel,
    lastCheckedAt: Schema.Number,
  }),
  Schema.Struct({
    status: Schema.Literal("available"),
    currentVersion: Schema.String,
    channel: UpdateChannel,
    nextVersion: Schema.String,
    releaseUrl: Schema.NullOr(Schema.String),
    releaseNotes: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("downloading"),
    currentVersion: Schema.String,
    channel: UpdateChannel,
    nextVersion: Schema.String,
    transferred: Schema.Number,
    total: Schema.Number,
  }),
  Schema.Struct({
    status: Schema.Literal("ready"),
    currentVersion: Schema.String,
    channel: UpdateChannel,
    nextVersion: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    currentVersion: Schema.String,
    channel: UpdateChannel,
    message: Schema.String,
  }),
])
export type UpdaterState = Schema.Schema.Type<typeof UpdaterState>

export const UpdaterGetStateCommand = defineCommand(
  "updater.getState",
  Schema.Struct({}),
  UpdaterState,
)

export const UpdaterCheckForUpdatesCommand = defineCommand(
  "updater.checkForUpdates",
  Schema.Struct({}),
  UpdaterState,
)

export const UpdaterDownloadUpdateCommand = defineCommand(
  "updater.downloadUpdate",
  Schema.Struct({}),
  UpdaterState,
)

export const UpdaterQuitAndInstallCommand = defineCommand(
  "updater.quitAndInstall",
  Schema.Struct({}),
  Schema.Struct({ ok: Schema.Boolean }),
)

export const UpdaterSetChannelCommand = defineCommand(
  "updater.setChannel",
  Schema.Struct({ channel: UpdateChannel }),
  UpdaterState,
)

export const UpdaterOpenReleasePageCommand = defineCommand(
  "updater.openReleasePage",
  Schema.Struct({}),
  Schema.Struct({ ok: Schema.Boolean }),
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
  "transaction.import.preview": ImportPreviewCommand,
  "transaction.import.commit": ImportCommitCommand,
  "system.stats": SystemStatsCommand,
  "system.export": SystemExportCommand,
  "system.import": SystemImportCommand,
  "system.rebuildProjections": SystemRebuildCommand,
  "vault.status": VaultStatusCommand,
  "vault.unlock": VaultUnlockCommand,
  "vault.lock": VaultLockCommand,
  "updater.getState": UpdaterGetStateCommand,
  "updater.checkForUpdates": UpdaterCheckForUpdatesCommand,
  "updater.downloadUpdate": UpdaterDownloadUpdateCommand,
  "updater.quitAndInstall": UpdaterQuitAndInstallCommand,
  "updater.setChannel": UpdaterSetChannelCommand,
  "updater.openReleasePage": UpdaterOpenReleasePageCommand,
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
  readonly onUpdateEvent: (handler: (state: unknown) => void) => () => void
  readonly platform:
    | "aix"
    | "android"
    | "darwin"
    | "freebsd"
    | "haiku"
    | "linux"
    | "openbsd"
    | "sunos"
    | "win32"
    | "cygwin"
    | "netbsd"
}
