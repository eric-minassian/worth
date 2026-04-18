import { Effect, Layer, ManagedRuntime } from "effect"
import { asc, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DbConfigLive, DbLive, Db, schema } from "@worth/db"
import type {
  CurrencyCode,
  DeviceId,
  InstrumentId,
  InvestmentAccountId,
  Quantity,
} from "@worth/domain"
import {
  HlcClockLive,
  newInstrumentId,
  newInvestmentAccountId,
  newInvestmentTransactionId,
} from "@worth/sync"
import { EventLog, EventLogLive, SystemService, SystemServiceLive } from "../src"

const USD = "USD" as CurrencyCode
const device = "test-device" as DeviceId

const makeRuntime = () => {
  const dbStack = DbLive.pipe(Layer.provide(DbConfigLive(":memory:", "test-password")))
  const clockStack = HlcClockLive({ deviceId: device })
  const eventLog = EventLogLive.pipe(Layer.provide(Layer.merge(dbStack, clockStack)))
  const base = Layer.mergeAll(dbStack, clockStack, eventLog)
  const appLayer = Layer.mergeAll(base, SystemServiceLive.pipe(Layer.provide(base)))
  return ManagedRuntime.make(appLayer)
}

let runtime: ReturnType<typeof makeRuntime>

beforeEach(() => {
  runtime = makeRuntime()
})

afterEach(async () => {
  await runtime.dispose()
})

// 1e8 micro-share scale — one share is 100_000_000n.
const shares = (n: number): Quantity => BigInt(Math.round(n * 1e8)) as Quantity

const seed = () =>
  Effect.gen(function* () {
    const log = yield* EventLog
    const accountId = newInvestmentAccountId()
    const instrumentId = newInstrumentId()
    yield* log.append({
      _tag: "InvestmentAccountCreated",
      id: accountId,
      name: "Fidelity Brokerage",
      institution: "Fidelity",
      currency: USD,
      at: 1_700_000_000_000,
    })
    yield* log.append({
      _tag: "InstrumentCreated",
      id: instrumentId,
      symbol: "VTI",
      name: "Vanguard Total Stock Market ETF",
      kind: "etf",
      currency: USD,
      at: 1_700_000_000_000,
    })
    return { accountId, instrumentId }
  })

const buy = (
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  postedAt: number,
  qty: number,
  pricePerShareMinor: bigint,
  feesMinor = 0n,
) =>
  Effect.gen(function* () {
    const log = yield* EventLog
    const id = newInvestmentTransactionId()
    // total = -(qty*price + fees) — negative = cash out
    const totalMinor =
      -(BigInt(Math.round(qty * Number(pricePerShareMinor))) + feesMinor)
    yield* log.append({
      _tag: "InvestmentBuyRecorded",
      id,
      accountId,
      instrumentId,
      postedAt,
      quantity: shares(qty),
      pricePerShare: { minor: pricePerShareMinor, currency: USD },
      fees: { minor: feesMinor, currency: USD },
      total: { minor: totalMinor, currency: USD },
      at: postedAt,
    })
    return id
  })

const sell = (
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  postedAt: number,
  qty: number,
  pricePerShareMinor: bigint,
  feesMinor = 0n,
) =>
  Effect.gen(function* () {
    const log = yield* EventLog
    const id = newInvestmentTransactionId()
    const totalMinor =
      BigInt(Math.round(qty * Number(pricePerShareMinor))) - feesMinor
    yield* log.append({
      _tag: "InvestmentSellRecorded",
      id,
      accountId,
      instrumentId,
      postedAt,
      quantity: shares(qty),
      pricePerShare: { minor: pricePerShareMinor, currency: USD },
      fees: { minor: feesMinor, currency: USD },
      total: { minor: totalMinor, currency: USD },
      at: postedAt,
    })
    return id
  })

const getHolding = (accountId: InvestmentAccountId, instrumentId: InstrumentId) =>
  Effect.gen(function* () {
    const db = yield* Db
    return db.drizzle
      .select()
      .from(schema.holdings)
      .where(
        eq(schema.holdings.accountId, accountId),
      )
      .all()
      .find((h) => h.instrumentId === instrumentId)
  })

const getLots = (accountId: InvestmentAccountId, instrumentId: InstrumentId) =>
  Effect.gen(function* () {
    const db = yield* Db
    return db.drizzle
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.accountId, accountId))
      .orderBy(asc(schema.lots.openedAt), asc(schema.lots.id))
      .all()
      .filter((l) => l.instrumentId === instrumentId)
  })

describe("InvestmentAccount + Instrument", () => {
  it("creates projections from events", async () => {
    const { accounts, instruments } = await runtime.runPromise(
      Effect.gen(function* () {
        yield* seed()
        const db = yield* Db
        return {
          accounts: db.drizzle.select().from(schema.investmentAccounts).all(),
          instruments: db.drizzle.select().from(schema.instruments).all(),
        }
      }),
    )
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.name).toBe("Fidelity Brokerage")
    expect(instruments[0]?.symbol).toBe("VTI")
  })

  it("rename + archive update in place", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId } = yield* seed()
        const log = yield* EventLog
        yield* log.append({
          _tag: "InvestmentAccountRenamed",
          id: accountId,
          name: "Fidelity (renamed)",
        })
        yield* log.append({
          _tag: "InvestmentAccountArchived",
          id: accountId,
          at: 1_700_000_100_000,
        })
        const db = yield* Db
        return db.drizzle.select().from(schema.investmentAccounts).all()
      }),
    )
    expect(result[0]?.name).toBe("Fidelity (renamed)")
    expect(result[0]?.archivedAt).toBe(1_700_000_100_000)
  })
})

describe("Buy / Sell / FIFO", () => {
  it("buy creates a lot and holding", async () => {
    const { holding, lots } = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        yield* buy(accountId, instrumentId, 1_700_000_100_000, 10, 200_00n)
        return {
          holding: yield* getHolding(accountId, instrumentId),
          lots: yield* getLots(accountId, instrumentId),
        }
      }),
    )
    expect(holding?.quantity).toBe(10 * 1e8)
    // 10 shares @ $200 = $2000 = 200_000 cents
    expect(holding?.costBasisMinor).toBe(200_000)
    expect(lots).toHaveLength(1)
    expect(lots[0]?.originalCostBasisMinor).toBe(200_000)
    expect(lots[0]?.remainingCostBasisMinor).toBe(200_000)
  })

  it("partial sell consumes lots FIFO", async () => {
    const { holding, lots } = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        // Lot A: 10 sh @ $100 on day 1
        yield* buy(accountId, instrumentId, 1_700_000_000_000, 10, 100_00n)
        // Lot B: 10 sh @ $200 on day 2
        yield* buy(accountId, instrumentId, 1_700_086_400_000, 10, 200_00n)
        // Sell 5 sh @ $250 on day 3 — should come out of Lot A
        yield* sell(accountId, instrumentId, 1_700_172_800_000, 5, 250_00n)
        return {
          holding: yield* getHolding(accountId, instrumentId),
          lots: yield* getLots(accountId, instrumentId),
        }
      }),
    )
    // Holding: 15 shares remaining, basis = Lot A remaining (500_00) + Lot B (2000_00)
    expect(holding?.quantity).toBe(15 * 1e8)
    expect(holding?.costBasisMinor).toBe(50_000 + 200_000)
    // Lot A drained from 10 to 5, basis halved
    expect(lots[0]?.remainingQuantity).toBe(5 * 1e8)
    expect(lots[0]?.remainingCostBasisMinor).toBe(50_000)
    // Lot B untouched
    expect(lots[1]?.remainingQuantity).toBe(10 * 1e8)
    expect(lots[1]?.remainingCostBasisMinor).toBe(200_000)
  })

  it("sell that crosses a lot boundary drains the first and chips the second", async () => {
    const { holding, lots } = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        yield* buy(accountId, instrumentId, 1_700_000_000_000, 10, 100_00n)
        yield* buy(accountId, instrumentId, 1_700_086_400_000, 10, 200_00n)
        yield* sell(accountId, instrumentId, 1_700_172_800_000, 15, 250_00n)
        return {
          holding: yield* getHolding(accountId, instrumentId),
          lots: yield* getLots(accountId, instrumentId),
        }
      }),
    )
    expect(holding?.quantity).toBe(5 * 1e8)
    // Lot A fully drained, Lot B halved → basis = 100_00
    expect(holding?.costBasisMinor).toBe(100_000)
    expect(lots[0]?.remainingQuantity).toBe(0)
    expect(lots[0]?.remainingCostBasisMinor).toBe(0)
    expect(lots[1]?.remainingQuantity).toBe(5 * 1e8)
    expect(lots[1]?.remainingCostBasisMinor).toBe(100_000)
  })

  it("selling the full position drops the holdings row", async () => {
    const holding = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        yield* buy(accountId, instrumentId, 1_700_000_000_000, 10, 100_00n)
        yield* sell(accountId, instrumentId, 1_700_086_400_000, 10, 120_00n)
        return yield* getHolding(accountId, instrumentId)
      }),
    )
    expect(holding).toBeUndefined()
  })
})

describe("Splits", () => {
  it("2-for-1 split doubles quantity, preserves cost basis", async () => {
    const { holding, lots } = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        yield* buy(accountId, instrumentId, 1_700_000_000_000, 10, 100_00n)
        const log = yield* EventLog
        yield* log.append({
          _tag: "InvestmentSplitRecorded",
          id: newInvestmentTransactionId(),
          instrumentId,
          postedAt: 1_700_086_400_000,
          numerator: 2,
          denominator: 1,
          at: 1_700_086_400_000,
        })
        return {
          holding: yield* getHolding(accountId, instrumentId),
          lots: yield* getLots(accountId, instrumentId),
        }
      }),
    )
    expect(holding?.quantity).toBe(20 * 1e8)
    expect(holding?.costBasisMinor).toBe(100_000) // unchanged
    expect(lots[0]?.originalQuantity).toBe(20 * 1e8)
    expect(lots[0]?.remainingQuantity).toBe(20 * 1e8)
    expect(lots[0]?.remainingCostBasisMinor).toBe(100_000)
  })
})

describe("Dividends", () => {
  it("dividend projects an investment_transactions row and doesn't touch lots", async () => {
    const { lots, dividends } = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        yield* buy(accountId, instrumentId, 1_700_000_000_000, 10, 100_00n)
        const log = yield* EventLog
        yield* log.append({
          _tag: "InvestmentDividendRecorded",
          id: newInvestmentTransactionId(),
          accountId,
          instrumentId,
          postedAt: 1_700_086_400_000,
          amount: { minor: 25_00n, currency: USD },
          at: 1_700_086_400_000,
        })
        const db = yield* Db
        return {
          lots: yield* getLots(accountId, instrumentId),
          dividends: db.drizzle
            .select()
            .from(schema.investmentTransactions)
            .where(eq(schema.investmentTransactions.kind, "dividend"))
            .all(),
        }
      }),
    )
    expect(dividends).toHaveLength(1)
    expect(dividends[0]?.amountMinor).toBe(2500)
    expect(lots[0]?.remainingQuantity).toBe(10 * 1e8)
  })
})

describe("PriceQuote", () => {
  it("upserts per (instrument, asOf); last event wins", async () => {
    const quotes = await runtime.runPromise(
      Effect.gen(function* () {
        const { instrumentId } = yield* seed()
        const log = yield* EventLog
        yield* log.append({
          _tag: "PriceQuoteRecorded",
          instrumentId,
          asOf: 1_700_000_000_000,
          price: { minor: 200_00n, currency: USD },
          at: 1_700_000_000_000,
        })
        yield* log.append({
          _tag: "PriceQuoteRecorded",
          instrumentId,
          asOf: 1_700_000_000_000, // same asOf, updated price
          price: { minor: 205_00n, currency: USD },
          at: 1_700_000_001_000,
        })
        const db = yield* Db
        return db.drizzle.select().from(schema.priceQuotes).all()
      }),
    )
    expect(quotes).toHaveLength(1)
    expect(quotes[0]?.priceMinor).toBe(20500)
  })
})

describe("Rebuild determinism", () => {
  it("rebuildProjections reproduces lots + holdings state", async () => {
    const { before, after } = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        yield* buy(accountId, instrumentId, 1_700_000_000_000, 10, 100_00n)
        yield* buy(accountId, instrumentId, 1_700_086_400_000, 5, 150_00n)
        yield* sell(accountId, instrumentId, 1_700_172_800_000, 7, 200_00n)
        const log = yield* EventLog
        yield* log.append({
          _tag: "InvestmentSplitRecorded",
          id: newInvestmentTransactionId(),
          instrumentId,
          postedAt: 1_700_259_200_000,
          numerator: 3,
          denominator: 2,
          at: 1_700_259_200_000,
        })

        const snap = (): Effect.Effect<
          { lots: unknown[]; holdings: unknown[]; invTxns: unknown[] },
          never,
          Db
        > =>
          Effect.gen(function* () {
            const db = yield* Db
            return {
              lots: db.drizzle.select().from(schema.lots).orderBy(asc(schema.lots.id)).all(),
              holdings: db.drizzle
                .select()
                .from(schema.holdings)
                .orderBy(asc(schema.holdings.accountId), asc(schema.holdings.instrumentId))
                .all(),
              invTxns: db.drizzle
                .select()
                .from(schema.investmentTransactions)
                .orderBy(asc(schema.investmentTransactions.id))
                .all(),
            }
          })

        const before = yield* snap()
        const sys = yield* SystemService
        yield* sys.rebuildProjections
        const after = yield* snap()
        return { before, after }
      }),
    )
    expect(after).toEqual(before)
  })
})
