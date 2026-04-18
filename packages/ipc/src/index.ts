import { Schema } from "effect"
import {
  Account,
  AccountId,
  AccountType,
  CashFlowKind,
  Category,
  CategoryId,
  CurrencyCode,
  DeviceId,
  Hlc,
  Holding,
  Instrument,
  InstrumentId,
  InstrumentKind,
  InvestmentAccount,
  InvestmentAccountId,
  InvestmentCashBalance,
  InvestmentTransaction,
  InvestmentTransactionKind,
  Money,
  PriceQuote,
  Quantity,
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

export const TransactionDeleteManyCommand = defineCommand(
  "transaction.deleteMany",
  Schema.Struct({ ids: Schema.Array(TransactionId) }),
  Schema.Struct({ deleted: Schema.Number }),
)

export const TransactionListDuplicatesCommand = defineCommand(
  "transaction.listDuplicates",
  Schema.Struct({
    accountId: Schema.UndefinedOr(AccountId),
    windowDays: Schema.UndefinedOr(Schema.Number),
  }),
  Schema.Array(
    Schema.Struct({
      accountId: AccountId,
      postedAt: Schema.Number,
      amount: Money,
      members: Schema.Array(Transaction),
    }),
  ),
)

export const TransactionDismissDuplicateGroupCommand = defineCommand(
  "transaction.dismissDuplicateGroup",
  Schema.Struct({ memberIds: Schema.Array(TransactionId) }),
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

// OFX/QFX import — typed, institution-provided format. No column mapping
// needed; FITID provides stable dedup across re-imports.

const OfxSampleRow = Schema.Struct({
  postedAt: Schema.Number,
  // Minor units are BigInt in domain code; serialized as decimal string for wire.
  amountMinor: Schema.String,
  payee: Schema.String,
  memo: Schema.NullOr(Schema.String),
})

const OfxStatementPreview = Schema.Struct({
  externalKey: Schema.String,
  institutionId: Schema.NullOr(Schema.String),
  accountIdHint: Schema.String,
  accountType: Schema.NullOr(Schema.String),
  currency: Schema.NullOr(Schema.String),
  transactionCount: Schema.Number,
  earliest: Schema.NullOr(Schema.Number),
  latest: Schema.NullOr(Schema.Number),
  matchedAccountId: Schema.NullOr(AccountId),
  sample: Schema.Array(OfxSampleRow),
})

const OfxInvSampleRow = Schema.Struct({
  kind: Schema.Literals(["buy", "sell", "dividend", "reinvest", "cash"]),
  tradeDate: Schema.Number,
  symbol: Schema.NullOr(Schema.String),
  securityName: Schema.String,
  units: Schema.NullOr(Schema.String),
  unitPriceMinor: Schema.NullOr(Schema.String),
  totalMinor: Schema.String,
})

const OfxInvStatementPreview = Schema.Struct({
  externalKey: Schema.String,
  brokerId: Schema.NullOr(Schema.String),
  accountIdHint: Schema.String,
  currency: Schema.NullOr(Schema.String),
  transactionCount: Schema.Number,
  tradeCount: Schema.Number,
  dividendCount: Schema.Number,
  securityCount: Schema.Number,
  earliest: Schema.NullOr(Schema.Number),
  latest: Schema.NullOr(Schema.Number),
  matchedInvestmentAccountId: Schema.NullOr(InvestmentAccountId),
  sample: Schema.Array(OfxInvSampleRow),
})

export const ImportOfxPreviewCommand = defineCommand(
  "transaction.import.ofxPreview",
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({
    statements: Schema.Array(OfxStatementPreview),
    investmentStatements: Schema.Array(OfxInvStatementPreview),
    investmentStatementCount: Schema.Number,
    warnings: Schema.Array(Schema.String),
  }),
)

// Fidelity CSV — Accounts_History.csv style export. Shape parallels OFX
// investment import (multi-account grouping by CSV Account Number column).

const FidelityInvSampleRow = Schema.Struct({
  kind: Schema.Literals(["buy", "sell", "dividend", "reinvest", "cash"]),
  tradeDate: Schema.Number,
  symbol: Schema.NullOr(Schema.String),
  securityName: Schema.String,
  units: Schema.NullOr(Schema.String),
  unitPriceMinor: Schema.NullOr(Schema.String),
  totalMinor: Schema.String,
})

const FidelityStatementPreview = Schema.Struct({
  externalKey: Schema.String,
  accountNumber: Schema.String,
  accountLabel: Schema.String,
  transactionCount: Schema.Number,
  tradeCount: Schema.Number,
  dividendCount: Schema.Number,
  reinvestCount: Schema.Number,
  securityCount: Schema.Number,
  earliest: Schema.NullOr(Schema.Number),
  latest: Schema.NullOr(Schema.Number),
  matchedInvestmentAccountId: Schema.NullOr(InvestmentAccountId),
  sample: Schema.Array(FidelityInvSampleRow),
})

export const ImportFidelityPreviewCommand = defineCommand(
  "transaction.import.fidelityPreview",
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({
    statements: Schema.Array(FidelityStatementPreview),
    warnings: Schema.Array(Schema.String),
  }),
)

export const ImportFidelityCommitCommand = defineCommand(
  "transaction.import.fidelityCommit",
  Schema.Struct({
    text: Schema.String,
    assignments: Schema.Array(
      Schema.Struct({
        externalKey: Schema.String,
        investmentAccountId: InvestmentAccountId,
        linkAccount: Schema.Boolean,
      }),
    ),
  }),
  Schema.Struct({
    perStatement: Schema.Array(
      Schema.Struct({
        externalKey: Schema.String,
        investmentAccountId: InvestmentAccountId,
        total: Schema.Number,
        imported: Schema.Number,
        duplicates: Schema.Number,
        instrumentsCreated: Schema.Number,
      }),
    ),
    warnings: Schema.Array(Schema.String),
  }),
)

export const ImportOfxCommitCommand = defineCommand(
  "transaction.import.ofxCommit",
  Schema.Struct({
    text: Schema.String,
    assignments: Schema.Array(
      Schema.Struct({
        externalKey: Schema.String,
        accountId: AccountId,
        linkAccount: Schema.Boolean,
      }),
    ),
    investmentAssignments: Schema.UndefinedOr(
      Schema.Array(
        Schema.Struct({
          externalKey: Schema.String,
          investmentAccountId: InvestmentAccountId,
          linkAccount: Schema.Boolean,
        }),
      ),
    ),
  }),
  Schema.Struct({
    perStatement: Schema.Array(
      Schema.Struct({
        externalKey: Schema.String,
        accountId: AccountId,
        total: Schema.Number,
        imported: Schema.Number,
        duplicates: Schema.Number,
      }),
    ),
    perInvestmentStatement: Schema.Array(
      Schema.Struct({
        externalKey: Schema.String,
        investmentAccountId: InvestmentAccountId,
        total: Schema.Number,
        imported: Schema.Number,
        duplicates: Schema.Number,
        instrumentsCreated: Schema.Number,
      }),
    ),
    investmentStatementCount: Schema.Number,
    warnings: Schema.Array(Schema.String),
  }),
)

// -- Instrument commands ----------------------------------------------------

export const InstrumentCreateCommand = defineCommand(
  "instrument.create",
  Schema.Struct({
    symbol: Schema.String,
    name: Schema.String,
    kind: InstrumentKind,
    currency: CurrencyCode,
  }),
  Instrument,
)

export const InstrumentListCommand = defineCommand(
  "instrument.list",
  Schema.Struct({}),
  Schema.Array(Instrument),
)

export const InstrumentGetCommand = defineCommand(
  "instrument.get",
  Schema.Struct({ id: InstrumentId }),
  Instrument,
)

export const InstrumentFindBySymbolCommand = defineCommand(
  "instrument.findBySymbol",
  Schema.Struct({ symbol: Schema.String }),
  Schema.NullOr(Instrument),
)

export const InstrumentRecordPriceCommand = defineCommand(
  "instrument.recordPrice",
  Schema.Struct({
    instrumentId: InstrumentId,
    asOf: Schema.Number,
    price: Money,
  }),
  Schema.Void,
)

export const InstrumentLatestPriceCommand = defineCommand(
  "instrument.latestPrice",
  Schema.Struct({ instrumentId: InstrumentId }),
  Schema.NullOr(PriceQuote),
)

export const InstrumentListPricesCommand = defineCommand(
  "instrument.listPrices",
  Schema.Struct({
    instrumentId: InstrumentId,
    since: Schema.UndefinedOr(Schema.Number),
    until: Schema.UndefinedOr(Schema.Number),
    limit: Schema.UndefinedOr(Schema.Number),
  }),
  Schema.Array(PriceQuote),
)

// -- InvestmentAccount commands ---------------------------------------------

export const InvestmentAccountCreateCommand = defineCommand(
  "investmentAccount.create",
  Schema.Struct({
    name: Schema.String,
    institution: Schema.NullOr(Schema.String),
    currency: CurrencyCode,
  }),
  InvestmentAccount,
)

export const InvestmentAccountListCommand = defineCommand(
  "investmentAccount.list",
  Schema.Struct({}),
  Schema.Array(InvestmentAccount),
)

export const InvestmentAccountGetCommand = defineCommand(
  "investmentAccount.get",
  Schema.Struct({ id: InvestmentAccountId }),
  InvestmentAccount,
)

export const InvestmentAccountRenameCommand = defineCommand(
  "investmentAccount.rename",
  Schema.Struct({ id: InvestmentAccountId, name: Schema.String }),
  Schema.Void,
)

export const InvestmentAccountArchiveCommand = defineCommand(
  "investmentAccount.archive",
  Schema.Struct({ id: InvestmentAccountId }),
  Schema.Void,
)

export const InvestmentAccountListHoldingsCommand = defineCommand(
  "investmentAccount.listHoldings",
  Schema.Struct({ accountId: Schema.UndefinedOr(InvestmentAccountId) }),
  Schema.Array(Holding),
)

export const InvestmentAccountListCashBalancesCommand = defineCommand(
  "investmentAccount.listCashBalances",
  Schema.Struct({ accountId: Schema.UndefinedOr(InvestmentAccountId) }),
  Schema.Array(InvestmentCashBalance),
)

// -- Investment transaction commands ----------------------------------------

export const InvestmentBuyCommand = defineCommand(
  "investment.buy",
  Schema.Struct({
    accountId: InvestmentAccountId,
    instrumentId: InstrumentId,
    postedAt: Schema.Number,
    quantity: Quantity,
    pricePerShare: Money,
    fees: Schema.UndefinedOr(Money),
  }),
  InvestmentTransaction,
)

export const InvestmentSellCommand = defineCommand(
  "investment.sell",
  Schema.Struct({
    accountId: InvestmentAccountId,
    instrumentId: InstrumentId,
    postedAt: Schema.Number,
    quantity: Quantity,
    pricePerShare: Money,
    fees: Schema.UndefinedOr(Money),
  }),
  InvestmentTransaction,
)

export const InvestmentDividendCommand = defineCommand(
  "investment.dividend",
  Schema.Struct({
    accountId: InvestmentAccountId,
    instrumentId: InstrumentId,
    postedAt: Schema.Number,
    amount: Money,
  }),
  InvestmentTransaction,
)

export const InvestmentSplitCommand = defineCommand(
  "investment.split",
  Schema.Struct({
    instrumentId: InstrumentId,
    postedAt: Schema.Number,
    numerator: Schema.Number,
    denominator: Schema.Number,
  }),
  Schema.Void,
)

export const InvestmentRecordCashFlowCommand = defineCommand(
  "investment.recordCashFlow",
  Schema.Struct({
    accountId: InvestmentAccountId,
    postedAt: Schema.Number,
    kind: CashFlowKind,
    amount: Money,
    memo: Schema.NullOr(Schema.String),
  }),
  InvestmentTransaction,
)

export const InvestmentListCommand = defineCommand(
  "investment.list",
  Schema.Struct({
    accountId: Schema.UndefinedOr(InvestmentAccountId),
    instrumentId: Schema.UndefinedOr(InstrumentId),
    kind: Schema.UndefinedOr(InvestmentTransactionKind),
    limit: Schema.UndefinedOr(Schema.Number),
    order: Schema.UndefinedOr(Schema.Literals(["posted-asc", "posted-desc"])),
  }),
  Schema.Array(InvestmentTransaction),
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

export const VaultBiometricStatusCommand = defineCommand(
  "vault.biometricStatus",
  Schema.Struct({}),
  Schema.Struct({
    available: Schema.Boolean,
    enabled: Schema.Boolean,
  }),
)

export const VaultEnableBiometricCommand = defineCommand(
  "vault.enableBiometric",
  Schema.Struct({}),
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true) }),
    Schema.Struct({
      ok: Schema.Literal(false),
      reason: Schema.Literals(["unavailable", "locked"]),
    }),
  ]),
)

export const VaultDisableBiometricCommand = defineCommand(
  "vault.disableBiometric",
  Schema.Struct({}),
  Schema.Struct({ ok: Schema.Boolean }),
)

export const VaultUnlockBiometricCommand = defineCommand(
  "vault.unlockBiometric",
  Schema.Struct({}),
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true) }),
    Schema.Struct({
      ok: Schema.Literal(false),
      reason: Schema.Literals([
        "wrong-password",
        "corrupt",
        "user-cancelled",
        "unavailable",
        "not-enabled",
      ]),
    }),
  ]),
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
  "transaction.deleteMany": TransactionDeleteManyCommand,
  "transaction.listDuplicates": TransactionListDuplicatesCommand,
  "transaction.dismissDuplicateGroup": TransactionDismissDuplicateGroupCommand,
  "transaction.import.preview": ImportPreviewCommand,
  "transaction.import.commit": ImportCommitCommand,
  "transaction.import.ofxPreview": ImportOfxPreviewCommand,
  "transaction.import.ofxCommit": ImportOfxCommitCommand,
  "transaction.import.fidelityPreview": ImportFidelityPreviewCommand,
  "transaction.import.fidelityCommit": ImportFidelityCommitCommand,
  "instrument.create": InstrumentCreateCommand,
  "instrument.list": InstrumentListCommand,
  "instrument.get": InstrumentGetCommand,
  "instrument.findBySymbol": InstrumentFindBySymbolCommand,
  "instrument.recordPrice": InstrumentRecordPriceCommand,
  "instrument.latestPrice": InstrumentLatestPriceCommand,
  "instrument.listPrices": InstrumentListPricesCommand,
  "investmentAccount.create": InvestmentAccountCreateCommand,
  "investmentAccount.list": InvestmentAccountListCommand,
  "investmentAccount.get": InvestmentAccountGetCommand,
  "investmentAccount.rename": InvestmentAccountRenameCommand,
  "investmentAccount.archive": InvestmentAccountArchiveCommand,
  "investmentAccount.listHoldings": InvestmentAccountListHoldingsCommand,
  "investmentAccount.listCashBalances": InvestmentAccountListCashBalancesCommand,
  "investment.buy": InvestmentBuyCommand,
  "investment.sell": InvestmentSellCommand,
  "investment.dividend": InvestmentDividendCommand,
  "investment.split": InvestmentSplitCommand,
  "investment.recordCashFlow": InvestmentRecordCashFlowCommand,
  "investment.list": InvestmentListCommand,
  "system.stats": SystemStatsCommand,
  "system.export": SystemExportCommand,
  "system.import": SystemImportCommand,
  "system.rebuildProjections": SystemRebuildCommand,
  "vault.status": VaultStatusCommand,
  "vault.unlock": VaultUnlockCommand,
  "vault.lock": VaultLockCommand,
  "vault.biometricStatus": VaultBiometricStatusCommand,
  "vault.enableBiometric": VaultEnableBiometricCommand,
  "vault.disableBiometric": VaultDisableBiometricCommand,
  "vault.unlockBiometric": VaultUnlockBiometricCommand,
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
