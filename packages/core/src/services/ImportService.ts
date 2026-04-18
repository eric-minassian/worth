import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import {
  type AccountId,
  type CashFlowKind,
  type CurrencyCode,
  type InstrumentId,
  type InstrumentKind,
  type InvestmentAccountId,
  type InvestmentTransactionId,
  NotFound,
  type Quantity,
} from "@worth/domain"
import {
  computeImportHash,
  computeOfxImportHash,
  externalAccountKey,
  externalFidelityAccountKey,
  externalInvestmentAccountKey,
  type FidelityInstrumentKey,
  type FidelityTransaction,
  mapRows,
  parseCsv,
  parseFidelityCsv,
  parseOfx,
  suggestMapping,
  type ColumnMapping,
  type MapError,
  type OfxInvStatement,
  type OfxInvTransaction,
  type OfxSecId,
  type OfxSecurity,
  type OfxSecurityKind,
  type OfxTransaction,
} from "@worth/importers"
import { newTransactionId } from "@worth/sync"
import { EventLog } from "../EventLog"
import { hasContentFingerprint } from "../events/fingerprint"

export interface ImportPreview {
  readonly headers: readonly string[]
  readonly sampleRows: readonly (readonly string[])[]
  readonly totalRows: number
  readonly suggestedMapping: ColumnMapping
}

export interface ImportRequest {
  readonly accountId: AccountId
  readonly text: string
  readonly mapping: ColumnMapping
}

export interface ImportResult {
  readonly total: number
  readonly imported: number
  readonly duplicates: number
  readonly errors: readonly MapError[]
}

export interface OfxSampleRow {
  readonly postedAt: number
  readonly amountMinor: string // BigInt serialized — IPC has no BigInt on the wire
  readonly payee: string
  readonly memo: string | null
}

export interface OfxStatementPreview {
  readonly externalKey: string
  readonly institutionId: string | null
  readonly accountIdHint: string
  readonly accountType: string | null
  readonly currency: string | null
  readonly transactionCount: number
  readonly earliest: number | null
  readonly latest: number | null
  readonly matchedAccountId: AccountId | null
  readonly sample: readonly OfxSampleRow[]
}

export interface OfxInvSampleRow {
  readonly kind: "buy" | "sell" | "dividend" | "reinvest" | "cash"
  readonly tradeDate: number
  readonly symbol: string | null
  readonly securityName: string
  readonly units: string | null // bigint serialized
  readonly unitPriceMinor: string | null
  readonly totalMinor: string // bigint serialized
}

export interface OfxInvStatementPreview {
  readonly externalKey: string
  readonly brokerId: string | null
  readonly accountIdHint: string
  readonly currency: string | null
  readonly transactionCount: number
  readonly tradeCount: number
  readonly dividendCount: number
  readonly securityCount: number
  readonly earliest: number | null
  readonly latest: number | null
  readonly matchedInvestmentAccountId: InvestmentAccountId | null
  readonly sample: readonly OfxInvSampleRow[]
}

export interface OfxPreview {
  readonly statements: readonly OfxStatementPreview[]
  readonly investmentStatements: readonly OfxInvStatementPreview[]
  readonly investmentStatementCount: number
  readonly warnings: readonly string[]
}

export interface OfxAssignment {
  readonly externalKey: string
  readonly accountId: AccountId
  readonly linkAccount: boolean
}

export interface OfxInvAssignment {
  readonly externalKey: string
  readonly investmentAccountId: InvestmentAccountId
  readonly linkAccount: boolean
}

export interface OfxCommitRequest {
  readonly text: string
  readonly assignments: readonly OfxAssignment[]
  readonly investmentAssignments?: readonly OfxInvAssignment[] | undefined
}

export interface OfxStatementResult {
  readonly externalKey: string
  readonly accountId: AccountId
  readonly total: number
  readonly imported: number
  readonly duplicates: number
}

export interface OfxInvStatementResult {
  readonly externalKey: string
  readonly investmentAccountId: InvestmentAccountId
  readonly total: number
  readonly imported: number
  readonly duplicates: number
  readonly instrumentsCreated: number
}

export interface OfxCommitResult {
  readonly perStatement: readonly OfxStatementResult[]
  readonly perInvestmentStatement: readonly OfxInvStatementResult[]
  readonly investmentStatementCount: number
  readonly warnings: readonly string[]
}

// -- Fidelity CSV -----------------------------------------------------------
//
// Fidelity's Accounts_History.csv shape parallels OFX investment statements
// but with multi-account grouping by the CSV's `Account Number` column.

export interface FidelityInvSampleRow {
  readonly kind: "buy" | "sell" | "dividend" | "reinvest" | "cash"
  readonly tradeDate: number
  readonly symbol: string | null
  readonly securityName: string
  readonly units: string | null
  readonly unitPriceMinor: string | null
  readonly totalMinor: string
}

export interface FidelityStatementPreview {
  readonly externalKey: string
  readonly accountNumber: string
  readonly accountLabel: string
  readonly transactionCount: number
  readonly tradeCount: number
  readonly dividendCount: number
  readonly reinvestCount: number
  readonly securityCount: number
  readonly earliest: number | null
  readonly latest: number | null
  readonly matchedInvestmentAccountId: InvestmentAccountId | null
  readonly sample: readonly FidelityInvSampleRow[]
}

export interface FidelityPreview {
  readonly statements: readonly FidelityStatementPreview[]
  readonly warnings: readonly string[]
}

export interface FidelityAssignment {
  readonly externalKey: string
  readonly investmentAccountId: InvestmentAccountId
  readonly linkAccount: boolean
}

export interface FidelityCommitRequest {
  readonly text: string
  readonly assignments: readonly FidelityAssignment[]
}

export interface FidelityStatementResult {
  readonly externalKey: string
  readonly investmentAccountId: InvestmentAccountId
  readonly total: number
  readonly imported: number
  readonly duplicates: number
  readonly instrumentsCreated: number
}

export interface FidelityCommitResult {
  readonly perStatement: readonly FidelityStatementResult[]
  readonly warnings: readonly string[]
}

export class ImportService extends Context.Service<
  ImportService,
  {
    readonly preview: (input: { text: string }) => Effect.Effect<ImportPreview>
    readonly commit: (input: ImportRequest) => Effect.Effect<ImportResult, NotFound>
    readonly ofxPreview: (input: { text: string }) => Effect.Effect<OfxPreview>
    readonly ofxCommit: (input: OfxCommitRequest) => Effect.Effect<OfxCommitResult, NotFound>
    readonly fidelityPreview: (input: { text: string }) => Effect.Effect<FidelityPreview>
    readonly fidelityCommit: (
      input: FidelityCommitRequest,
    ) => Effect.Effect<FidelityCommitResult, NotFound>
  }
>()("@worth/core/ImportService") {}

const maskAccountId = (id: string): string => {
  if (id.length <= 4) return id
  return `••••${id.slice(-4)}`
}

const buildMemo = (txn: OfxTransaction): string | null => {
  const parts: string[] = []
  if (txn.memo && txn.memo.trim().length > 0) parts.push(txn.memo.trim())
  if (txn.checkNumber && txn.checkNumber.trim().length > 0) {
    parts.push(`Check #${txn.checkNumber.trim()}`)
  }
  if (parts.length === 0) return null
  return parts.join(" — ")
}

const buildPayee = (txn: OfxTransaction): string => {
  const name = txn.payee.trim()
  if (name.length > 0) return name
  if (txn.type) return txn.type
  return "Unknown"
}

const secIdKey = (secId: OfxSecId): string =>
  `${secId.uniqueIdType}:${secId.uniqueId}`

/**
 * Deterministic instrument id from an OFX SECID. Lets re-imports dedupe
 * naturally — applyEvent's `onConflictDoNothing` on the projection insert
 * keeps the id stable across repeat parses.
 */
const instrumentIdFromSecId = (secId: OfxSecId): InstrumentId =>
  `ofx-sec:${secIdKey(secId)}` as InstrumentId

/** Deterministic investment-transaction id, namespaced by the broker source. */
const invTxnIdFromFitid = (
  externalKey: string,
  fitid: string,
): InvestmentTransactionId =>
  `${externalKey}:${fitid}` as InvestmentTransactionId

/**
 * A reinvested dividend expands to two distinct events (dividend + buy).
 * Both must have unique, stable ids; suffix the base id so re-imports dedupe
 * and projection rebuilds stay correct.
 */
const reinvestChildIds = (base: InvestmentTransactionId) => ({
  dividendId: `${base}:div` as InvestmentTransactionId,
  buyId: `${base}:buy` as InvestmentTransactionId,
})

/**
 * OFX `<TRNTYPE>` → our {@link CashFlowKind}. Signed `amount` guides the
 * fallback between deposit/withdrawal when the TRNTYPE is absent or generic.
 */
const classifyOfxCashFlow = (
  trnType: string | null,
  amountMinor: bigint,
): CashFlowKind => {
  const t = (trnType ?? "").toUpperCase()
  if (t === "INT") return "interest"
  if (t === "DIV") return "deposit" // rare in INVBANKTRAN; treat as cash in
  if (t === "FEE" || t === "SRVCHG") return "fee"
  if (t === "XFER" || t === "TRANSFER") return "transfer"
  if (t === "DEP" || t === "CREDIT" || t === "DIRECTDEP") return "deposit"
  if (t === "DEBIT" || t === "CHECK" || t === "CASH" || t === "ATM") return "withdrawal"
  return amountMinor >= 0n ? "deposit" : "withdrawal"
}

const mapSecurityKind = (kind: OfxSecurityKind): InstrumentKind => {
  switch (kind) {
    case "stock":
      return "stock"
    case "mutual_fund":
      return "mutual_fund"
    case "bond":
      return "bond"
    case "other":
      return "other"
  }
}

/**
 * Deterministic instrument id derived from a Fidelity row's identity.
 * Symbol-keyed rows carry the ticker across imports (so future Fidelity
 * imports with the same ticker resolve to the same instrument). Symbol-less
 * rows (401k funds) key by normalized description.
 */
const instrumentIdFromFidelityKey = (key: FidelityInstrumentKey): InstrumentId => {
  if (key.kind === "symbol") {
    return `csv-fidelity-sec:sym:${key.symbol}` as InstrumentId
  }
  const normalized = key.name.toLowerCase().replace(/\s+/g, " ").trim()
  return `csv-fidelity-sec:name:${normalized}` as InstrumentId
}

const fidelityInstrumentSymbol = (key: FidelityInstrumentKey): string =>
  key.kind === "symbol" ? key.symbol : key.name

const fidelityInstrumentName = (key: FidelityInstrumentKey): string => key.name

/**
 * 401(k) fund rows have no ticker — kind defaults to "mutual_fund" because
 * that's what they almost always are in a retirement plan. Symbol-keyed
 * rows stay "other" absent richer metadata (we don't know if AAPL is stock
 * vs ETF from the CSV alone).
 */
const fidelityInstrumentKind = (key: FidelityInstrumentKey): InstrumentKind =>
  key.kind === "symbol" ? "other" : "mutual_fund"

export const ImportServiceLive = Layer.effect(ImportService)(
  Effect.gen(function* () {
    const db = yield* Db
    const log = yield* EventLog

    const accountCurrency = (id: AccountId): CurrencyCode | null => {
      const row = db.drizzle
        .select({ currency: schema.accounts.currency })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, id))
        .get()
      return (row?.currency as CurrencyCode | undefined) ?? null
    }

    const accountIdByExternalKey = (key: string): AccountId | null => {
      const row = db.drizzle
        .select({ accountId: schema.accountExternalKeys.accountId })
        .from(schema.accountExternalKeys)
        .where(eq(schema.accountExternalKeys.externalKey, key))
        .get()
      return (row?.accountId as AccountId | undefined) ?? null
    }

    const externalKeyExists = (key: string): boolean =>
      accountIdByExternalKey(key) !== null

    const investmentAccountById = (
      id: InvestmentAccountId,
    ): { readonly currency: CurrencyCode } | null => {
      const row = db.drizzle
        .select({ currency: schema.investmentAccounts.currency })
        .from(schema.investmentAccounts)
        .where(eq(schema.investmentAccounts.id, id))
        .get()
      return row ? { currency: row.currency as CurrencyCode } : null
    }

    const investmentAccountIdByExternalKey = (
      key: string,
    ): InvestmentAccountId | null => {
      const row = db.drizzle
        .select({ accountId: schema.investmentAccountExternalKeys.accountId })
        .from(schema.investmentAccountExternalKeys)
        .where(eq(schema.investmentAccountExternalKeys.externalKey, key))
        .get()
      return (row?.accountId as InvestmentAccountId | undefined) ?? null
    }

    const investmentExternalKeyExists = (key: string): boolean =>
      investmentAccountIdByExternalKey(key) !== null

    const instrumentExistsById = (id: InstrumentId): boolean =>
      db.drizzle
        .select({ id: schema.instruments.id })
        .from(schema.instruments)
        .where(eq(schema.instruments.id, id))
        .get() !== undefined

    /**
     * Cross-source instrument dedup. If a ticker already exists in the
     * projection — regardless of which importer created it — subsequent
     * imports reuse the existing instrument rather than emitting a parallel
     * InstrumentCreated with a different source-prefixed id. Silently no-op
     * for symbols that haven't been seen before; caller falls back to its
     * own derived id.
     */
    const instrumentIdBySymbol = (symbol: string): InstrumentId | null => {
      const row = db.drizzle
        .select({ id: schema.instruments.id })
        .from(schema.instruments)
        .where(eq(schema.instruments.symbol, symbol))
        .get()
      return (row?.id as InstrumentId | undefined) ?? null
    }

    const invTxnExistsById = (id: InvestmentTransactionId): boolean =>
      db.drizzle
        .select({ id: schema.investmentTransactions.id })
        .from(schema.investmentTransactions)
        .where(eq(schema.investmentTransactions.id, id))
        .get() !== undefined

    const contentDuplicateExists = (
      accountId: AccountId,
      postedAt: number,
      amountMinor: bigint,
      currency: CurrencyCode,
    ): boolean =>
      hasContentFingerprint(db.drizzle, accountId, postedAt, amountMinor, currency)

    const preview = (input: { text: string }): Effect.Effect<ImportPreview> =>
      Effect.sync(() => {
        const csv = parseCsv(input.text)
        return {
          headers: csv.headers,
          sampleRows: csv.rows.slice(0, 5),
          totalRows: csv.rows.length,
          suggestedMapping: suggestMapping(csv.headers),
        }
      })

    const commit = (input: ImportRequest): Effect.Effect<ImportResult, NotFound> =>
      Effect.gen(function* () {
        const currency = accountCurrency(input.accountId)
        if (!currency) {
          return yield* Effect.fail(new NotFound({ entity: "Account", id: input.accountId }))
        }

        const csv = parseCsv(input.text)
        const { rows, errors } = mapRows(csv.headers, csv.rows, input.mapping, currency)

        let imported = 0
        let duplicates = 0

        for (const row of rows) {
          const hash = computeImportHash(input.accountId, row)
          const existing = db.drizzle
            .select({ id: schema.transactions.id })
            .from(schema.transactions)
            .where(
              and(
                eq(schema.transactions.accountId, input.accountId),
                eq(schema.transactions.importHash, hash),
              ),
            )
            .get()
          if (existing) {
            duplicates++
            continue
          }
          if (
            contentDuplicateExists(
              input.accountId,
              row.postedAt,
              row.amount.minor,
              row.amount.currency,
            )
          ) {
            duplicates++
            continue
          }
          yield* log.append({
            _tag: "TransactionImported",
            id: newTransactionId(),
            accountId: input.accountId,
            postedAt: row.postedAt,
            amount: row.amount,
            payee: row.payee,
            memo: row.memo,
            importHash: hash,
            at: Date.now(),
          })
          imported++
        }

        return { total: rows.length, imported, duplicates, errors }
      })

    const ofxPreview = (input: { text: string }): Effect.Effect<OfxPreview> =>
      Effect.sync(() => {
        const parsed = parseOfx(input.text)
        const statements = parsed.statements.map((s): OfxStatementPreview => {
          const key = externalAccountKey(s.account)
          let earliest: number | null = null
          let latest: number | null = null
          for (const t of s.transactions) {
            if (earliest === null || t.postedAt < earliest) earliest = t.postedAt
            if (latest === null || t.postedAt > latest) latest = t.postedAt
          }
          return {
            externalKey: key,
            institutionId: s.account.institutionId,
            accountIdHint: maskAccountId(s.account.accountId),
            accountType: s.account.accountType,
            currency: s.account.currency,
            transactionCount: s.transactions.length,
            earliest,
            latest,
            matchedAccountId: accountIdByExternalKey(key),
            sample: s.transactions.slice(0, 5).map((t) => ({
              postedAt: t.postedAt,
              amountMinor: t.amountMinor.toString(),
              payee: buildPayee(t),
              memo: buildMemo(t),
            })),
          }
        })

        const secById = new Map(parsed.securities.map((s) => [secIdKey(s.secId), s]))
        const investmentStatements = parsed.investmentStatements.map(
          (s): OfxInvStatementPreview => {
            const key = externalInvestmentAccountKey(s.account)
            let earliest: number | null = null
            let latest: number | null = null
            let tradeCount = 0
            let dividendCount = 0
            const securities = new Set<string>()
            for (const t of s.transactions) {
              if (earliest === null || t.tradeDate < earliest) earliest = t.tradeDate
              if (latest === null || t.tradeDate > latest) latest = t.tradeDate
              if (t.kind === "cash") continue
              if (t.kind === "dividend") dividendCount++
              else tradeCount++
              securities.add(secIdKey(t.secId))
            }
            return {
              externalKey: key,
              brokerId: s.account.brokerId,
              accountIdHint: maskAccountId(s.account.accountId),
              currency: s.account.currency,
              transactionCount: s.transactions.length,
              tradeCount,
              dividendCount,
              securityCount: securities.size,
              earliest,
              latest,
              matchedInvestmentAccountId: investmentAccountIdByExternalKey(key),
              sample: s.transactions.slice(0, 5).map((t): OfxInvSampleRow => {
                if (t.kind === "cash") {
                  return {
                    kind: "cash",
                    tradeDate: t.tradeDate,
                    symbol: null,
                    securityName: t.memo ?? "Cash movement",
                    units: null,
                    unitPriceMinor: null,
                    totalMinor: t.amountMinor.toString(),
                  }
                }
                const sec = secById.get(secIdKey(t.secId))
                return {
                  kind: t.kind,
                  tradeDate: t.tradeDate,
                  symbol: sec?.ticker ?? null,
                  securityName: sec?.name ?? t.secId.uniqueId,
                  units: "units" in t ? t.units.toString() : null,
                  unitPriceMinor:
                    "unitPriceMinor" in t ? t.unitPriceMinor.toString() : null,
                  totalMinor: t.totalMinor.toString(),
                }
              }),
            }
          },
        )

        return {
          statements,
          investmentStatements,
          investmentStatementCount: parsed.investmentStatementCount,
          warnings: parsed.warnings,
        }
      })

    const ofxCommit = (input: OfxCommitRequest): Effect.Effect<OfxCommitResult, NotFound> =>
      Effect.gen(function* () {
        const parsed = parseOfx(input.text)
        const assignmentByKey = new Map(
          input.assignments.map((a) => [a.externalKey, a] as const),
        )
        const invAssignmentByKey = new Map(
          (input.investmentAssignments ?? []).map((a) => [a.externalKey, a] as const),
        )

        for (const a of input.assignments) {
          if (!accountCurrency(a.accountId)) {
            return yield* Effect.fail(new NotFound({ entity: "Account", id: a.accountId }))
          }
        }
        for (const a of input.investmentAssignments ?? []) {
          if (!investmentAccountById(a.investmentAccountId)) {
            return yield* Effect.fail(
              new NotFound({
                entity: "InvestmentAccount",
                id: a.investmentAccountId,
              }),
            )
          }
        }

        const perStatement: OfxStatementResult[] = []

        for (const statement of parsed.statements) {
          const key = externalAccountKey(statement.account)
          const assignment = assignmentByKey.get(key)
          if (!assignment) continue
          const { accountId, linkAccount } = assignment
          const currency = accountCurrency(accountId)
          if (!currency) {
            return yield* Effect.fail(new NotFound({ entity: "Account", id: accountId }))
          }

          if (linkAccount && !externalKeyExists(key)) {
            yield* log.append({
              _tag: "AccountExternalKeyLinked",
              id: accountId,
              externalKey: key,
              at: Date.now(),
            })
          }

          let imported = 0
          let duplicates = 0

          for (const txn of statement.transactions) {
            const hash = computeOfxImportHash(accountId, txn.fitid)
            const existing = db.drizzle
              .select({ id: schema.transactions.id })
              .from(schema.transactions)
              .where(
                and(
                  eq(schema.transactions.accountId, accountId),
                  eq(schema.transactions.importHash, hash),
                ),
              )
              .get()
            if (existing) {
              duplicates++
              continue
            }
            if (contentDuplicateExists(accountId, txn.postedAt, txn.amountMinor, currency)) {
              duplicates++
              continue
            }
            yield* log.append({
              _tag: "TransactionImported",
              id: newTransactionId(),
              accountId,
              postedAt: txn.postedAt,
              amount: { minor: txn.amountMinor, currency },
              payee: buildPayee(txn),
              memo: buildMemo(txn),
              importHash: hash,
              at: Date.now(),
            })
            imported++
          }

          perStatement.push({
            externalKey: key,
            accountId,
            total: statement.transactions.length,
            imported,
            duplicates,
          })
        }

        const perInvestmentStatement = yield* commitInvestmentStatements(
          parsed.investmentStatements,
          parsed.securities,
          invAssignmentByKey,
        )

        return {
          perStatement,
          perInvestmentStatement,
          investmentStatementCount: parsed.investmentStatementCount,
          warnings: parsed.warnings,
        }
      })

    const commitInvestmentStatements = (
      invStatements: readonly OfxInvStatement[],
      securities: readonly OfxSecurity[],
      assignmentByKey: ReadonlyMap<string, OfxInvAssignment>,
    ): Effect.Effect<readonly OfxInvStatementResult[]> =>
      Effect.gen(function* () {
        if (invStatements.length === 0) return []
        const secById = new Map(securities.map((s) => [secIdKey(s.secId), s]))
        const out: OfxInvStatementResult[] = []

        for (const statement of invStatements) {
          const key = externalInvestmentAccountKey(statement.account)
          const assignment = assignmentByKey.get(key)
          if (!assignment) continue
          const { investmentAccountId, linkAccount } = assignment
          const account = investmentAccountById(investmentAccountId)
          if (!account) continue // validated above, but keep the guard for type narrowing

          if (linkAccount && !investmentExternalKeyExists(key)) {
            yield* log.append({
              _tag: "InvestmentAccountExternalKeyLinked",
              id: investmentAccountId,
              externalKey: key,
              at: Date.now(),
            })
          }

          const statementCurrency =
            (statement.account.currency as CurrencyCode | null) ?? account.currency

          let imported = 0
          let duplicates = 0
          let instrumentsCreated = 0

          // Track instruments created within this commit so we don't emit two
          // InstrumentCreated events for the same secId in one pass.
          const createdThisPass = new Set<string>()

          for (const txn of statement.transactions) {
            const invTxnId = invTxnIdFromFitid(key, txn.fitid)
            const primaryId =
              txn.kind === "reinvest"
                ? reinvestChildIds(invTxnId).buyId
                : invTxnId
            if (invTxnExistsById(primaryId)) {
              duplicates++
              continue
            }

            // Cash-only transactions (INVBANKTRAN) never reference a
            // security — skip instrument resolution entirely.
            if (txn.kind === "cash") {
              yield* emitInvTxnEvent(
                txn,
                invTxnId,
                investmentAccountId,
                null,
                statementCurrency,
              )
              imported++
              continue
            }

            const secKey = secIdKey(txn.secId)
            const sec = secById.get(secKey)
            const ticker = sec?.ticker ?? null
            // Prefer an existing instrument with matching ticker (maybe
            // created by a different importer); fall back to our derived id.
            const existingIdByTicker =
              ticker !== null ? instrumentIdBySymbol(ticker) : null
            const instrumentId = existingIdByTicker ?? instrumentIdFromSecId(txn.secId)
            if (!instrumentExistsById(instrumentId) && !createdThisPass.has(secKey)) {
              const symbol = ticker ?? txn.secId.uniqueId
              const name = sec?.name ?? symbol
              const kind: InstrumentKind = sec ? mapSecurityKind(sec.kind) : "other"
              const currency =
                (sec?.currency as CurrencyCode | null | undefined) ?? statementCurrency
              yield* log.append({
                _tag: "InstrumentCreated",
                id: instrumentId,
                symbol,
                name,
                kind,
                currency,
                at: Date.now(),
              })
              createdThisPass.add(secKey)
              instrumentsCreated++
            }

            yield* emitInvTxnEvent(
              txn,
              invTxnId,
              investmentAccountId,
              instrumentId,
              statementCurrency,
            )
            imported++
          }

          out.push({
            externalKey: key,
            investmentAccountId,
            total: statement.transactions.length,
            imported,
            duplicates,
            instrumentsCreated,
          })
        }
        return out
      })

    const emitInvTxnEvent = (
      txn: OfxInvTransaction,
      invTxnId: InvestmentTransactionId,
      accountId: InvestmentAccountId,
      instrumentId: InstrumentId | null,
      currency: CurrencyCode,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const at = Date.now()
        if (txn.kind === "cash") {
          yield* log.append({
            _tag: "InvestmentCashFlowRecorded",
            id: invTxnId,
            accountId,
            postedAt: txn.tradeDate,
            kind: classifyOfxCashFlow(txn.trnType, txn.amountMinor),
            amount: { minor: txn.amountMinor, currency },
            memo: txn.memo,
            at,
          })
          return
        }
        // All non-cash events require an instrument. The caller's control
        // flow guarantees this; assert via a hard narrowing.
        if (instrumentId === null) return
        if (txn.kind === "buy") {
          yield* log.append({
            _tag: "InvestmentBuyRecorded",
            id: invTxnId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            quantity: txn.units as Quantity,
            pricePerShare: { minor: txn.unitPriceMinor, currency },
            fees: { minor: txn.feesMinor, currency },
            total: { minor: txn.totalMinor, currency },
            at,
          })
        } else if (txn.kind === "sell") {
          yield* log.append({
            _tag: "InvestmentSellRecorded",
            id: invTxnId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            quantity: txn.units as Quantity,
            pricePerShare: { minor: txn.unitPriceMinor, currency },
            fees: { minor: txn.feesMinor, currency },
            total: { minor: txn.totalMinor, currency },
            at,
          })
        } else if (txn.kind === "dividend") {
          yield* log.append({
            _tag: "InvestmentDividendRecorded",
            id: invTxnId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            amount: { minor: txn.totalMinor, currency },
            at,
          })
        } else if (txn.kind === "reinvest") {
          // reinvest — a dividend received + immediate buy of new shares.
          // Emit both events with correlated deterministic ids so re-imports
          // stay idempotent and lot history stays traceable.
          const { dividendId, buyId } = reinvestChildIds(invTxnId)
          yield* log.append({
            _tag: "InvestmentDividendRecorded",
            id: dividendId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            amount: { minor: txn.totalMinor, currency },
            at,
          })
          // Reinvested cash is spent on shares — total is negative from the
          // cash perspective, matching a regular buy.
          yield* log.append({
            _tag: "InvestmentBuyRecorded",
            id: buyId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            quantity: txn.units as Quantity,
            pricePerShare: { minor: txn.unitPriceMinor, currency },
            fees: { minor: txn.feesMinor, currency },
            total: { minor: -txn.totalMinor, currency },
            at,
          })
        }
      })

    const fidelityPreview = (input: { text: string }): Effect.Effect<FidelityPreview> =>
      Effect.sync(() => {
        const parsed = parseFidelityCsv(input.text)
        const statements = parsed.statements.map(
          (s): FidelityStatementPreview => {
            const key = externalFidelityAccountKey(s.accountNumber)
            let earliest: number | null = null
            let latest: number | null = null
            let tradeCount = 0
            let dividendCount = 0
            let reinvestCount = 0
            const instruments = new Set<string>()
            for (const t of s.transactions) {
              if (earliest === null || t.tradeDate < earliest) earliest = t.tradeDate
              if (latest === null || t.tradeDate > latest) latest = t.tradeDate
              if (t.kind === "cash") continue
              if (t.kind === "dividend") dividendCount++
              else if (t.kind === "reinvest") reinvestCount++
              else tradeCount++
              instruments.add(instrumentIdFromFidelityKey(t.instrumentKey))
            }
            return {
              externalKey: key,
              accountNumber: s.accountNumber,
              accountLabel: s.accountLabel,
              transactionCount: s.transactions.length,
              tradeCount,
              dividendCount,
              reinvestCount,
              securityCount: instruments.size,
              earliest,
              latest,
              matchedInvestmentAccountId: investmentAccountIdByExternalKey(key),
              sample: s.transactions.slice(0, 5).map(
                (t): FidelityInvSampleRow => {
                  if (t.kind === "cash") {
                    return {
                      kind: "cash",
                      tradeDate: t.tradeDate,
                      symbol: null,
                      securityName: t.memo,
                      units: null,
                      unitPriceMinor: null,
                      totalMinor: t.amountMinor.toString(),
                    }
                  }
                  return {
                    kind: t.kind,
                    tradeDate: t.tradeDate,
                    symbol:
                      t.instrumentKey.kind === "symbol"
                        ? t.instrumentKey.symbol
                        : null,
                    securityName: fidelityInstrumentName(t.instrumentKey),
                    units: "units" in t ? t.units.toString() : null,
                    unitPriceMinor:
                      "unitPriceMinor" in t ? t.unitPriceMinor.toString() : null,
                    totalMinor: t.totalMinor.toString(),
                  }
                },
              ),
            }
          },
        )
        return { statements, warnings: parsed.warnings }
      })

    const fidelityCommit = (
      input: FidelityCommitRequest,
    ): Effect.Effect<FidelityCommitResult, NotFound> =>
      Effect.gen(function* () {
        const parsed = parseFidelityCsv(input.text)
        const assignmentByKey = new Map(
          input.assignments.map((a) => [a.externalKey, a] as const),
        )

        for (const a of input.assignments) {
          if (!investmentAccountById(a.investmentAccountId)) {
            return yield* Effect.fail(
              new NotFound({
                entity: "InvestmentAccount",
                id: a.investmentAccountId,
              }),
            )
          }
        }

        const perStatement: FidelityStatementResult[] = []

        for (const statement of parsed.statements) {
          const key = externalFidelityAccountKey(statement.accountNumber)
          const assignment = assignmentByKey.get(key)
          if (!assignment) continue
          const { investmentAccountId, linkAccount } = assignment
          const account = investmentAccountById(investmentAccountId)
          if (!account) continue

          if (linkAccount && !investmentExternalKeyExists(key)) {
            yield* log.append({
              _tag: "InvestmentAccountExternalKeyLinked",
              id: investmentAccountId,
              externalKey: key,
              at: Date.now(),
            })
          }

          const currency = account.currency
          let imported = 0
          let duplicates = 0
          let instrumentsCreated = 0
          const createdThisPass = new Set<string>()

          for (const txn of statement.transactions) {
            const invTxnId = invTxnIdFromFitid(key, txn.fitid)
            const primaryId =
              txn.kind === "reinvest"
                ? reinvestChildIds(invTxnId).buyId
                : invTxnId
            if (invTxnExistsById(primaryId)) {
              duplicates++
              continue
            }

            if (txn.kind === "cash") {
              yield* emitFidelityTxnEvent(
                txn,
                invTxnId,
                investmentAccountId,
                null,
                currency,
              )
              imported++
              continue
            }

            // Symbol-keyed rows get cross-source dedup — a VTI already
            // created by an OFX import is reused here rather than forked.
            const derivedId = instrumentIdFromFidelityKey(txn.instrumentKey)
            const existingIdByTicker =
              txn.instrumentKey.kind === "symbol"
                ? instrumentIdBySymbol(txn.instrumentKey.symbol)
                : null
            const instrumentId = existingIdByTicker ?? derivedId
            const instrumentCacheKey = instrumentId
            if (
              !instrumentExistsById(instrumentId) &&
              !createdThisPass.has(instrumentCacheKey)
            ) {
              yield* log.append({
                _tag: "InstrumentCreated",
                id: instrumentId,
                symbol: fidelityInstrumentSymbol(txn.instrumentKey),
                name: fidelityInstrumentName(txn.instrumentKey),
                kind: fidelityInstrumentKind(txn.instrumentKey),
                currency,
                at: Date.now(),
              })
              createdThisPass.add(instrumentCacheKey)
              instrumentsCreated++
            }

            yield* emitFidelityTxnEvent(
              txn,
              invTxnId,
              investmentAccountId,
              instrumentId,
              currency,
            )
            imported++
          }

          perStatement.push({
            externalKey: key,
            investmentAccountId,
            total: statement.transactions.length,
            imported,
            duplicates,
            instrumentsCreated,
          })
        }

        return { perStatement, warnings: parsed.warnings }
      })

    const emitFidelityTxnEvent = (
      txn: FidelityTransaction,
      invTxnId: InvestmentTransactionId,
      accountId: InvestmentAccountId,
      instrumentId: InstrumentId | null,
      currency: CurrencyCode,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const at = Date.now()
        if (txn.kind === "cash") {
          yield* log.append({
            _tag: "InvestmentCashFlowRecorded",
            id: invTxnId,
            accountId,
            postedAt: txn.tradeDate,
            kind: txn.cashFlowKind,
            amount: { minor: txn.amountMinor, currency },
            memo: txn.memo,
            at,
          })
          return
        }
        if (instrumentId === null) return
        if (txn.kind === "buy") {
          yield* log.append({
            _tag: "InvestmentBuyRecorded",
            id: invTxnId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            quantity: txn.units as Quantity,
            pricePerShare: { minor: txn.unitPriceMinor, currency },
            fees: { minor: txn.feesMinor, currency },
            total: { minor: txn.totalMinor, currency },
            at,
          })
        } else if (txn.kind === "sell") {
          yield* log.append({
            _tag: "InvestmentSellRecorded",
            id: invTxnId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            quantity: txn.units as Quantity,
            pricePerShare: { minor: txn.unitPriceMinor, currency },
            fees: { minor: txn.feesMinor, currency },
            total: { minor: txn.totalMinor, currency },
            at,
          })
        } else if (txn.kind === "dividend") {
          yield* log.append({
            _tag: "InvestmentDividendRecorded",
            id: invTxnId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            amount: { minor: txn.totalMinor, currency },
            at,
          })
        } else {
          const { dividendId, buyId } = reinvestChildIds(invTxnId)
          yield* log.append({
            _tag: "InvestmentDividendRecorded",
            id: dividendId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            amount: { minor: txn.totalMinor, currency },
            at,
          })
          yield* log.append({
            _tag: "InvestmentBuyRecorded",
            id: buyId,
            accountId,
            instrumentId,
            postedAt: txn.tradeDate,
            quantity: txn.units as Quantity,
            pricePerShare: { minor: txn.unitPriceMinor, currency },
            fees: { minor: txn.feesMinor, currency },
            total: { minor: -txn.totalMinor, currency },
            at,
          })
        }
      })

    return {
      preview,
      commit,
      ofxPreview,
      ofxCommit,
      fidelityPreview,
      fidelityCommit,
    }
  }),
)
