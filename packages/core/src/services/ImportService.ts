import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import {
  type AccountId,
  type CurrencyCode,
  NotFound,
} from "@worth/domain"
import {
  computeImportHash,
  computeOfxImportHash,
  externalAccountKey,
  mapRows,
  parseCsv,
  parseOfx,
  suggestMapping,
  type ColumnMapping,
  type MapError,
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

export interface OfxPreview {
  readonly statements: readonly OfxStatementPreview[]
  readonly investmentStatementCount: number
  readonly warnings: readonly string[]
}

export interface OfxAssignment {
  readonly externalKey: string
  readonly accountId: AccountId
  readonly linkAccount: boolean
}

export interface OfxCommitRequest {
  readonly text: string
  readonly assignments: readonly OfxAssignment[]
}

export interface OfxStatementResult {
  readonly externalKey: string
  readonly accountId: AccountId
  readonly total: number
  readonly imported: number
  readonly duplicates: number
}

export interface OfxCommitResult {
  readonly perStatement: readonly OfxStatementResult[]
  readonly investmentStatementCount: number
  readonly warnings: readonly string[]
}

export class ImportService extends Context.Service<
  ImportService,
  {
    readonly preview: (input: { text: string }) => Effect.Effect<ImportPreview>
    readonly commit: (input: ImportRequest) => Effect.Effect<ImportResult, NotFound>
    readonly ofxPreview: (input: { text: string }) => Effect.Effect<OfxPreview>
    readonly ofxCommit: (input: OfxCommitRequest) => Effect.Effect<OfxCommitResult, NotFound>
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
        return {
          statements,
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

        for (const a of input.assignments) {
          if (!accountCurrency(a.accountId)) {
            return yield* Effect.fail(new NotFound({ entity: "Account", id: a.accountId }))
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

        return {
          perStatement,
          investmentStatementCount: parsed.investmentStatementCount,
          warnings: parsed.warnings,
        }
      })

    return { preview, commit, ofxPreview, ofxCommit }
  }),
)
