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
  mapRows,
  parseCsv,
  suggestMapping,
  type ColumnMapping,
  type MapError,
} from "@worth/importers"
import { newTransactionId } from "@worth/sync"
import { EventLog } from "../EventLog"

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

export class ImportService extends Context.Service<
  ImportService,
  {
    readonly preview: (input: { text: string }) => Effect.Effect<ImportPreview>
    readonly commit: (input: ImportRequest) => Effect.Effect<ImportResult, NotFound>
  }
>()("@worth/core/ImportService") {}

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

    return { preview, commit }
  }),
)
