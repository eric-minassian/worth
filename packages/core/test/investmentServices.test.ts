import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DbConfigLive, DbLive } from "@worth/db"
import type {
  CurrencyCode,
  DeviceId,
  InstrumentId,
  InvestmentAccountId,
  Quantity,
} from "@worth/domain"
import { HlcClockLive } from "@worth/sync"
import {
  EventLogLive,
  InstrumentService,
  InstrumentServiceLive,
  InvestmentAccountService,
  InvestmentAccountServiceLive,
  InvestmentTransactionService,
  InvestmentTransactionServiceLive,
} from "../src"

const USD = "USD" as CurrencyCode
const device = "test-device" as DeviceId

const makeRuntime = () => {
  const dbStack = DbLive.pipe(Layer.provide(DbConfigLive(":memory:", "test-password")))
  const clockStack = HlcClockLive({ deviceId: device })
  const eventLog = EventLogLive.pipe(Layer.provide(Layer.merge(dbStack, clockStack)))
  const base = Layer.mergeAll(dbStack, clockStack, eventLog)
  const appLayer = Layer.mergeAll(
    base,
    InstrumentServiceLive.pipe(Layer.provide(base)),
    InvestmentAccountServiceLive.pipe(Layer.provide(base)),
    InvestmentTransactionServiceLive.pipe(Layer.provide(base)),
  )
  return ManagedRuntime.make(appLayer)
}

let runtime: ReturnType<typeof makeRuntime>

beforeEach(() => {
  runtime = makeRuntime()
})

afterEach(async () => {
  await runtime.dispose()
})

const shares = (n: number): Quantity => BigInt(Math.round(n * 1e8)) as Quantity

describe("InstrumentService", () => {
  it("create + list + findBySymbol round-trip", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* InstrumentService
        const vti = yield* svc.create({
          symbol: "VTI",
          name: "Vanguard Total Stock Market",
          kind: "etf",
          currency: USD,
        })
        const list = yield* svc.list
        const found = yield* svc.findBySymbol("VTI")
        return { vti, list, found }
      }),
    )
    expect(result.list.map((i) => i.symbol)).toEqual(["VTI"])
    expect(result.found?.id).toBe(result.vti.id)
  })

  it("findBySymbol returns null for unknown symbol", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* InstrumentService
        return yield* svc.findBySymbol("NOPE")
      }),
    )
    expect(result).toBeNull()
  })

  it("get fails NotFound for unknown id", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* InstrumentService
        return yield* svc.get("00000000-0000-0000-0000-000000000000" as InstrumentId)
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("recordPrice + latestPrice + listPrices", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* InstrumentService
        const vti = yield* svc.create({
          symbol: "VTI",
          name: "VTI",
          kind: "etf",
          currency: USD,
        })
        for (const [day, priceCents] of [
          [1_700_000_000_000, 200_00],
          [1_700_086_400_000, 205_00],
          [1_700_172_800_000, 198_00],
        ] as const) {
          yield* svc.recordPrice({
            instrumentId: vti.id,
            asOf: day,
            price: { minor: BigInt(priceCents), currency: USD },
          })
        }
        const latest = yield* svc.latestPrice(vti.id)
        const all = yield* svc.listPrices({ instrumentId: vti.id })
        return { latest, all }
      }),
    )
    expect(result.latest?.price.minor).toBe(19800n)
    expect(result.all).toHaveLength(3)
    // Ordered desc by asOf
    expect(result.all[0]?.asOf).toBe(1_700_172_800_000)
  })

  it("recordPrice fails NotFound for unknown instrument", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* InstrumentService
        yield* svc.recordPrice({
          instrumentId: "00000000-0000-0000-0000-000000000000" as InstrumentId,
          asOf: 1_700_000_000_000,
          price: { minor: 100n, currency: USD },
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("InvestmentAccountService", () => {
  it("create + list + rename + archive", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* InvestmentAccountService
        const a = yield* svc.create({
          name: "Fidelity",
          institution: "Fidelity",
          currency: USD,
        })
        yield* svc.rename({ id: a.id, name: "Fidelity Brokerage" })
        yield* svc.archive(a.id)
        const after = yield* svc.get(a.id)
        return after
      }),
    )
    expect(result.name).toBe("Fidelity Brokerage")
    expect(result.archivedAt).not.toBeNull()
  })

  it("rename fails NotFound for unknown id", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* InvestmentAccountService
        yield* svc.rename({
          id: "00000000-0000-0000-0000-000000000000" as InvestmentAccountId,
          name: "x",
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("listHoldings returns empty before any buys", async () => {
    const holdings = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* InvestmentAccountService
        const a = yield* svc.create({ name: "A", institution: null, currency: USD })
        return yield* svc.listHoldings(a.id)
      }),
    )
    expect(holdings).toEqual([])
  })
})

describe("InvestmentTransactionService", () => {
  const seed = () =>
    Effect.gen(function* () {
      const accountSvc = yield* InvestmentAccountService
      const instSvc = yield* InstrumentService
      const account = yield* accountSvc.create({
        name: "Brokerage",
        institution: null,
        currency: USD,
      })
      const instrument = yield* instSvc.create({
        symbol: "VTI",
        name: "VTI",
        kind: "etf",
        currency: USD,
      })
      return { accountId: account.id, instrumentId: instrument.id }
    })

  it("buy creates a holding with correct cost basis and signed total", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        const acctSvc = yield* InvestmentAccountService
        const buy = yield* txnSvc.buy({
          accountId,
          instrumentId,
          postedAt: 1_700_000_000_000,
          quantity: shares(10),
          pricePerShare: { minor: 200_00n, currency: USD },
          fees: { minor: 495n, currency: USD },
        })
        const holdings = yield* acctSvc.listHoldings(accountId)
        return { buy, holdings }
      }),
    )
    // 10 shares × $200 + $4.95 fee = $2004.95 = 200_495 cents, cash out so total is negative.
    expect(result.buy.amount.minor).toBe(-200_495n)
    expect(result.holdings).toHaveLength(1)
    expect(result.holdings[0]?.quantity).toBe(BigInt(10 * 1e8))
    expect(result.holdings[0]?.costBasis.minor).toBe(200_495n)
  })

  it("sell reduces holding and returns positive cash proceeds net of fees", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        const acctSvc = yield* InvestmentAccountService
        yield* txnSvc.buy({
          accountId,
          instrumentId,
          postedAt: 1_700_000_000_000,
          quantity: shares(10),
          pricePerShare: { minor: 100_00n, currency: USD },
        })
        const sell = yield* txnSvc.sell({
          accountId,
          instrumentId,
          postedAt: 1_700_086_400_000,
          quantity: shares(4),
          pricePerShare: { minor: 150_00n, currency: USD },
          fees: { minor: 100n, currency: USD },
        })
        const holdings = yield* acctSvc.listHoldings(accountId)
        return { sell, holdings }
      }),
    )
    // 4 × $150 - $1 = $599 = 59_900 cents
    expect(result.sell.amount.minor).toBe(59_900n)
    expect(result.holdings[0]?.quantity).toBe(BigInt(6 * 1e8))
    expect(result.holdings[0]?.costBasis.minor).toBe(60_000n) // 6 × $100
  })

  it("buy fails NotFound on unknown account", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const { instrumentId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        yield* txnSvc.buy({
          accountId: "00000000-0000-0000-0000-000000000000" as InvestmentAccountId,
          instrumentId,
          postedAt: 1_700_000_000_000,
          quantity: shares(1),
          pricePerShare: { minor: 100n, currency: USD },
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("dividend appears in list filtered by kind", async () => {
    const dividends = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        yield* txnSvc.dividend({
          accountId,
          instrumentId,
          postedAt: 1_700_000_000_000,
          amount: { minor: 25_00n, currency: USD },
        })
        return yield* txnSvc.list({ accountId, kind: "dividend" })
      }),
    )
    expect(dividends).toHaveLength(1)
    expect(dividends[0]?.amount.minor).toBe(2500n)
  })

  it("split multiplies quantities across every holder's lots", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        const acctSvc = yield* InvestmentAccountService
        yield* txnSvc.buy({
          accountId,
          instrumentId,
          postedAt: 1_700_000_000_000,
          quantity: shares(10),
          pricePerShare: { minor: 100_00n, currency: USD },
        })
        yield* txnSvc.split({
          instrumentId,
          postedAt: 1_700_086_400_000,
          numerator: 3,
          denominator: 1,
        })
        return yield* acctSvc.listHoldings(accountId)
      }),
    )
    expect(result[0]?.quantity).toBe(BigInt(30 * 1e8))
    // Cost basis unchanged by a split
    expect(result[0]?.costBasis.minor).toBe(100_000n)
  })

  it("recordCashFlow produces a listable balance", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        const acctSvc = yield* InvestmentAccountService
        yield* txnSvc.recordCashFlow({
          accountId,
          postedAt: 1_700_000_000_000,
          kind: "deposit",
          amount: { minor: 100_000n, currency: USD },
          memo: "Initial wire",
        })
        yield* txnSvc.recordCashFlow({
          accountId,
          postedAt: 1_700_086_400_000,
          kind: "fee",
          amount: { minor: -495n, currency: USD },
          memo: null,
        })
        return yield* acctSvc.listCashBalances(accountId)
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.minor).toBe(99_505n)
    expect(result[0]?.currency).toBe(USD)
  })

  it("buys/sells/dividends are included in the cash balance aggregation", async () => {
    const balance = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        const acctSvc = yield* InvestmentAccountService
        yield* txnSvc.recordCashFlow({
          accountId,
          postedAt: 1_700_000_000_000,
          kind: "deposit",
          amount: { minor: 1_000_000n, currency: USD },
          memo: null,
        })
        yield* txnSvc.buy({
          accountId,
          instrumentId,
          postedAt: 1_700_086_400_000,
          quantity: shares(10),
          pricePerShare: { minor: 10_000n, currency: USD },
        })
        yield* txnSvc.sell({
          accountId,
          instrumentId,
          postedAt: 1_700_172_800_000,
          quantity: shares(4),
          pricePerShare: { minor: 15_000n, currency: USD },
        })
        yield* txnSvc.dividend({
          accountId,
          instrumentId,
          postedAt: 1_700_259_200_000,
          amount: { minor: 2_500n, currency: USD },
        })
        const balances = yield* acctSvc.listCashBalances(accountId)
        return balances[0]?.minor ?? null
      }),
    )
    // $10,000 deposit − $1,000 buy + $600 sell + $25 dividend = $9,625
    expect(balance).toBe(962_500n)
  })

  it("recordCashFlow fails NotFound for unknown account", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* InvestmentTransactionService
        yield* svc.recordCashFlow({
          accountId: "00000000-0000-0000-0000-000000000000" as never,
          postedAt: 1_700_000_000_000,
          kind: "deposit",
          amount: { minor: 100n, currency: USD },
          memo: null,
        })
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("list orders posted-desc by default", async () => {
    const order = await runtime.runPromise(
      Effect.gen(function* () {
        const { accountId, instrumentId } = yield* seed()
        const txnSvc = yield* InvestmentTransactionService
        yield* txnSvc.buy({
          accountId,
          instrumentId,
          postedAt: 1_700_000_000_000,
          quantity: shares(1),
          pricePerShare: { minor: 100n, currency: USD },
        })
        yield* txnSvc.dividend({
          accountId,
          instrumentId,
          postedAt: 1_700_086_400_000,
          amount: { minor: 1n, currency: USD },
        })
        const txns = yield* txnSvc.list({ accountId })
        return txns.map((t) => t.kind)
      }),
    )
    expect(order).toEqual(["dividend", "buy"])
  })
})
