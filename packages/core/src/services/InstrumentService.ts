import { and, asc, desc, eq, gte, lte } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import {
  type CurrencyCode,
  type Instrument,
  type InstrumentId,
  type InstrumentKind,
  type Money,
  NotFound,
  type PriceQuote,
} from "@worth/domain"
import { newInstrumentId } from "@worth/sync"
import { EventLog } from "../EventLog"

export interface CreateInstrumentInput {
  readonly symbol: string
  readonly name: string
  readonly kind: InstrumentKind
  readonly currency: CurrencyCode
}

export interface RecordPriceInput {
  readonly instrumentId: InstrumentId
  readonly asOf: number
  readonly price: Money
}

export interface ListPricesQuery {
  readonly instrumentId: InstrumentId
  readonly since?: number | undefined
  readonly until?: number | undefined
  readonly limit?: number | undefined
}

export class InstrumentService extends Context.Service<
  InstrumentService,
  {
    readonly create: (input: CreateInstrumentInput) => Effect.Effect<Instrument>
    readonly list: Effect.Effect<readonly Instrument[]>
    readonly get: (id: InstrumentId) => Effect.Effect<Instrument, NotFound>
    readonly findBySymbol: (symbol: string) => Effect.Effect<Instrument | null>
    readonly recordPrice: (input: RecordPriceInput) => Effect.Effect<void, NotFound>
    readonly latestPrice: (id: InstrumentId) => Effect.Effect<PriceQuote | null>
    readonly listPrices: (query: ListPricesQuery) => Effect.Effect<readonly PriceQuote[]>
  }
>()("@worth/core/InstrumentService") {}

const rowToInstrument = (row: typeof schema.instruments.$inferSelect): Instrument => ({
  id: row.id as InstrumentId,
  symbol: row.symbol,
  name: row.name,
  kind: row.kind as InstrumentKind,
  currency: row.currency as CurrencyCode,
  createdAt: row.createdAt,
})

const rowToPriceQuote = (row: typeof schema.priceQuotes.$inferSelect): PriceQuote => ({
  instrumentId: row.instrumentId as InstrumentId,
  asOf: row.asOf,
  price: {
    minor: BigInt(row.priceMinor),
    currency: row.currency as CurrencyCode,
  },
  recordedAt: row.recordedAt,
})

export const InstrumentServiceLive = Layer.effect(InstrumentService)(
  Effect.gen(function* () {
    const db = yield* Db
    const log = yield* EventLog

    const selectById = (id: InstrumentId): Instrument | null => {
      const row = db.drizzle
        .select()
        .from(schema.instruments)
        .where(eq(schema.instruments.id, id))
        .get()
      return row ? rowToInstrument(row) : null
    }

    const create = (input: CreateInstrumentInput): Effect.Effect<Instrument> =>
      Effect.gen(function* () {
        const id = newInstrumentId()
        const at = Date.now()
        yield* log.append({
          _tag: "InstrumentCreated",
          id,
          symbol: input.symbol,
          name: input.name,
          kind: input.kind,
          currency: input.currency,
          at,
        })
        return {
          id,
          symbol: input.symbol,
          name: input.name,
          kind: input.kind,
          currency: input.currency,
          createdAt: at,
        }
      })

    const list = Effect.sync(() => {
      const rows = db.drizzle
        .select()
        .from(schema.instruments)
        .orderBy(asc(schema.instruments.symbol))
        .all()
      return rows.map(rowToInstrument)
    })

    const get = (id: InstrumentId): Effect.Effect<Instrument, NotFound> =>
      Effect.gen(function* () {
        const instrument = selectById(id)
        if (!instrument) return yield* Effect.fail(new NotFound({ entity: "Instrument", id }))
        return instrument
      })

    const findBySymbol = (symbol: string): Effect.Effect<Instrument | null> =>
      Effect.sync(() => {
        const row = db.drizzle
          .select()
          .from(schema.instruments)
          .where(eq(schema.instruments.symbol, symbol))
          .get()
        return row ? rowToInstrument(row) : null
      })

    const recordPrice = (input: RecordPriceInput): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        if (!selectById(input.instrumentId))
          return yield* Effect.fail(
            new NotFound({ entity: "Instrument", id: input.instrumentId }),
          )
        yield* log.append({
          _tag: "PriceQuoteRecorded",
          instrumentId: input.instrumentId,
          asOf: input.asOf,
          price: input.price,
          at: Date.now(),
        })
      })

    const latestPrice = (id: InstrumentId): Effect.Effect<PriceQuote | null> =>
      Effect.sync(() => {
        const row = db.drizzle
          .select()
          .from(schema.priceQuotes)
          .where(eq(schema.priceQuotes.instrumentId, id))
          .orderBy(desc(schema.priceQuotes.asOf))
          .limit(1)
          .get()
        return row ? rowToPriceQuote(row) : null
      })

    const listPrices = (query: ListPricesQuery): Effect.Effect<readonly PriceQuote[]> =>
      Effect.sync(() => {
        const conds = [eq(schema.priceQuotes.instrumentId, query.instrumentId)]
        if (query.since !== undefined) conds.push(gte(schema.priceQuotes.asOf, query.since))
        if (query.until !== undefined) conds.push(lte(schema.priceQuotes.asOf, query.until))
        const base = db.drizzle
          .select()
          .from(schema.priceQuotes)
          .where(and(...conds))
          .orderBy(desc(schema.priceQuotes.asOf))
        const limited =
          query.limit !== undefined && query.limit > 0 ? base.limit(query.limit) : base
        return limited.all().map(rowToPriceQuote)
      })

    return { create, list, get, findBySymbol, recordPrice, latestPrice, listPrices }
  }),
)
