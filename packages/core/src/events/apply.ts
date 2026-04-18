import { and, asc, eq, gt, isNotNull } from "drizzle-orm"
import type { DrizzleClient } from "@worth/db"
import { schema } from "@worth/db"
import type {
  DomainEvent,
  InstrumentId,
  InvestmentAccountId,
  InvestmentBuyRecorded,
  InvestmentDividendRecorded,
  InvestmentSellRecorded,
  InvestmentSplitRecorded,
} from "@worth/domain"
import { hasContentFingerprint } from "./fingerprint"

/**
 * Apply a single event to the projection tables. Called inside the same
 * transaction that appends to the event log. Must be deterministic — given
 * the same event, produces the same projection change.
 */
export const applyEvent = (db: DrizzleClient, event: DomainEvent): void => {
  switch (event._tag) {
    case "AccountCreated":
      db.insert(schema.accounts)
        .values({
          id: event.id,
          name: event.name,
          type: event.type,
          currency: event.currency,
          createdAt: event.at,
          archivedAt: null,
        })
        .onConflictDoNothing()
        .run()
      return

    case "AccountRenamed":
      db.update(schema.accounts)
        .set({ name: event.name })
        .where(eq(schema.accounts.id, event.id))
        .run()
      return

    case "AccountArchived":
      db.update(schema.accounts)
        .set({ archivedAt: event.at })
        .where(eq(schema.accounts.id, event.id))
        .run()
      return

    case "AccountExternalKeyLinked":
      db.insert(schema.accountExternalKeys)
        .values({
          externalKey: event.externalKey,
          accountId: event.id,
          linkedAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return

    case "CategoryCreated":
      db.insert(schema.categories)
        .values({
          id: event.id,
          name: event.name,
          parentId: event.parentId,
          color: event.color,
          createdAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return

    case "TransactionImported": {
      // Dedup by (account_id, import_hash) when an import hash is present.
      if (event.importHash !== null) {
        const existing = db
          .select({ id: schema.transactions.id })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.accountId, event.accountId),
              isNotNull(schema.transactions.importHash),
              eq(schema.transactions.importHash, event.importHash),
            ),
          )
          .limit(1)
          .all()
        if (existing.length > 0) return
      }
      // Gated to importHash !== null so manual TransactionService.create
      // retains its "duplicate-looking rows are allowed" semantics.
      if (
        event.importHash !== null &&
        hasContentFingerprint(
          db,
          event.accountId,
          event.postedAt,
          event.amount.minor,
          event.amount.currency,
        )
      ) {
        return
      }
      db.insert(schema.transactions)
        .values({
          id: event.id,
          accountId: event.accountId,
          postedAt: event.postedAt,
          amountMinor: Number(event.amount.minor),
          currency: event.amount.currency,
          payee: event.payee,
          memo: event.memo,
          categoryId: null,
          importHash: event.importHash,
          createdAt: event.at,
          updatedAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return
    }

    case "TransactionCategorized":
      db.update(schema.transactions)
        .set({ categoryId: event.categoryId, updatedAt: event.at })
        .where(eq(schema.transactions.id, event.id))
        .run()
      return

    case "TransactionEdited": {
      const patch: Partial<typeof schema.transactions.$inferInsert> = {
        updatedAt: event.at,
      }
      if (event.postedAt !== undefined) patch.postedAt = event.postedAt
      if (event.amount !== undefined) {
        patch.amountMinor = Number(event.amount.minor)
        patch.currency = event.amount.currency
      }
      if (event.payee !== undefined) patch.payee = event.payee
      if (event.memo !== undefined) patch.memo = event.memo
      db.update(schema.transactions)
        .set(patch)
        .where(eq(schema.transactions.id, event.id))
        .run()
      return
    }

    case "TransactionDeleted":
      db.delete(schema.transactions).where(eq(schema.transactions.id, event.id)).run()
      return

    case "DuplicateGroupDismissed": {
      const sorted = [...event.memberIds].sort()
      const key = sorted.join(",")
      db.insert(schema.duplicateDismissals)
        .values({
          memberKey: key,
          memberIds: JSON.stringify(sorted),
          dismissedAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return
    }

    case "InstrumentCreated":
      db.insert(schema.instruments)
        .values({
          id: event.id,
          symbol: event.symbol,
          name: event.name,
          kind: event.kind,
          currency: event.currency,
          createdAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return

    case "InvestmentAccountCreated":
      db.insert(schema.investmentAccounts)
        .values({
          id: event.id,
          name: event.name,
          institution: event.institution,
          currency: event.currency,
          createdAt: event.at,
          archivedAt: null,
        })
        .onConflictDoNothing()
        .run()
      return

    case "InvestmentAccountRenamed":
      db.update(schema.investmentAccounts)
        .set({ name: event.name })
        .where(eq(schema.investmentAccounts.id, event.id))
        .run()
      return

    case "InvestmentAccountArchived":
      db.update(schema.investmentAccounts)
        .set({ archivedAt: event.at })
        .where(eq(schema.investmentAccounts.id, event.id))
        .run()
      return

    case "InvestmentAccountExternalKeyLinked":
      db.insert(schema.investmentAccountExternalKeys)
        .values({
          externalKey: event.externalKey,
          accountId: event.id,
          linkedAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return

    case "InvestmentBuyRecorded":
      applyBuy(db, event)
      return

    case "InvestmentSellRecorded":
      applySell(db, event)
      return

    case "InvestmentDividendRecorded":
      applyDividend(db, event)
      return

    case "InvestmentSplitRecorded":
      applySplit(db, event)
      return

    case "InvestmentCashFlowRecorded":
      db.insert(schema.investmentTransactions)
        .values({
          id: event.id,
          accountId: event.accountId,
          instrumentId: null,
          kind: event.kind,
          postedAt: event.postedAt,
          quantity: null,
          pricePerShareMinor: null,
          feesMinor: null,
          amountMinor: Number(event.amount.minor),
          memo: event.memo,
          splitNumerator: null,
          splitDenominator: null,
          currency: event.amount.currency,
          createdAt: event.at,
        })
        .onConflictDoNothing()
        .run()
      return

    case "PriceQuoteRecorded": {
      const priceMinor = Number(event.price.minor)
      db.insert(schema.priceQuotes)
        .values({
          instrumentId: event.instrumentId,
          asOf: event.asOf,
          priceMinor,
          currency: event.price.currency,
          recordedAt: event.at,
        })
        .onConflictDoUpdate({
          target: [schema.priceQuotes.instrumentId, schema.priceQuotes.asOf],
          set: {
            priceMinor,
            currency: event.price.currency,
            recordedAt: event.at,
          },
        })
        .run()
      return
    }
  }
}

// -- Investment helpers -----------------------------------------------------

const applyBuy = (db: DrizzleClient, event: InvestmentBuyRecorded): void => {
  const quantity = Number(event.quantity)
  const totalMinor = Number(event.total.minor)
  const lotBasis = totalMinor < 0 ? -totalMinor : totalMinor

  db.insert(schema.investmentTransactions)
    .values({
      id: event.id,
      accountId: event.accountId,
      instrumentId: event.instrumentId,
      kind: "buy",
      postedAt: event.postedAt,
      quantity,
      pricePerShareMinor: Number(event.pricePerShare.minor),
      feesMinor: Number(event.fees.minor),
      amountMinor: totalMinor,
      splitNumerator: null,
      splitDenominator: null,
      currency: event.total.currency,
      createdAt: event.at,
    })
    .onConflictDoNothing()
    .run()

  // Cost basis for the new lot = absolute cash out = quantity*price + fees.
  // Using the event's |total| keeps apply pure: we trust what the event
  // carried rather than recomputing (and diverging on rounding).
  db.insert(schema.lots)
    .values({
      id: event.id,
      accountId: event.accountId,
      instrumentId: event.instrumentId,
      openedAt: event.postedAt,
      originalQuantity: quantity,
      remainingQuantity: quantity,
      originalCostBasisMinor: lotBasis,
      remainingCostBasisMinor: lotBasis,
      currency: event.total.currency,
    })
    .onConflictDoNothing()
    .run()

  bumpHolding(db, event.accountId, event.instrumentId, quantity, lotBasis, event.total.currency)
}

const applySell = (db: DrizzleClient, event: InvestmentSellRecorded): void => {
  const sellQty = Number(event.quantity)
  db.insert(schema.investmentTransactions)
    .values({
      id: event.id,
      accountId: event.accountId,
      instrumentId: event.instrumentId,
      kind: "sell",
      postedAt: event.postedAt,
      quantity: sellQty,
      pricePerShareMinor: Number(event.pricePerShare.minor),
      feesMinor: Number(event.fees.minor),
      amountMinor: Number(event.total.minor),
      splitNumerator: null,
      splitDenominator: null,
      currency: event.total.currency,
      createdAt: event.at,
    })
    .onConflictDoNothing()
    .run()

  if (sellQty <= 0) return

  // FIFO: consume from oldest lots first. Ordering by (opened_at, id) keeps
  // the reduction deterministic even when multiple buys share a timestamp.
  let toConsume = sellQty
  let basisConsumed = 0
  const openLots = db
    .select()
    .from(schema.lots)
    .where(
      and(
        eq(schema.lots.accountId, event.accountId),
        eq(schema.lots.instrumentId, event.instrumentId),
        gt(schema.lots.remainingQuantity, 0),
      ),
    )
    .orderBy(asc(schema.lots.openedAt), asc(schema.lots.id))
    .all()
  for (const lot of openLots) {
    if (toConsume === 0) break
    const take = lot.remainingQuantity < toConsume ? lot.remainingQuantity : toConsume
    const takeBasis =
      take === lot.remainingQuantity
        ? lot.remainingCostBasisMinor
        : Math.trunc((lot.remainingCostBasisMinor * take) / lot.remainingQuantity)
    db.update(schema.lots)
      .set({
        remainingQuantity: lot.remainingQuantity - take,
        remainingCostBasisMinor: lot.remainingCostBasisMinor - takeBasis,
      })
      .where(eq(schema.lots.id, lot.id))
      .run()
    toConsume -= take
    basisConsumed += takeBasis
  }

  // Holding reduces by the quantity actually consumed (ignoring any shortfall
  // — a sell beyond available lots is a no-op on the excess, same shape as
  // the banking TransactionImported dedup path).
  const consumedQty = sellQty - toConsume
  if (consumedQty > 0) {
    bumpHolding(
      db,
      event.accountId,
      event.instrumentId,
      -consumedQty,
      -basisConsumed,
      event.total.currency,
    )
  }
}

const applyDividend = (db: DrizzleClient, event: InvestmentDividendRecorded): void => {
  db.insert(schema.investmentTransactions)
    .values({
      id: event.id,
      accountId: event.accountId,
      instrumentId: event.instrumentId,
      kind: "dividend",
      postedAt: event.postedAt,
      quantity: null,
      pricePerShareMinor: null,
      feesMinor: null,
      amountMinor: Number(event.amount.minor),
      splitNumerator: null,
      splitDenominator: null,
      currency: event.amount.currency,
      createdAt: event.at,
    })
    .onConflictDoNothing()
    .run()
}

const applySplit = (db: DrizzleClient, event: InvestmentSplitRecorded): void => {
  if (event.denominator <= 0 || event.numerator <= 0) return

  // Splits are instrument-wide, not per-account — we don't project them into
  // investment_transactions (which is per-account). UI surfaces splits via
  // the event log directly when a split history is wanted.
  const num = event.numerator
  const den = event.denominator

  const lots = db
    .select()
    .from(schema.lots)
    .where(eq(schema.lots.instrumentId, event.instrumentId))
    .all()
  for (const lot of lots) {
    db.update(schema.lots)
      .set({
        originalQuantity: Math.trunc((lot.originalQuantity * num) / den),
        remainingQuantity: Math.trunc((lot.remainingQuantity * num) / den),
      })
      .where(eq(schema.lots.id, lot.id))
      .run()
  }

  const rows = db
    .select()
    .from(schema.holdings)
    .where(eq(schema.holdings.instrumentId, event.instrumentId))
    .all()
  for (const h of rows) {
    db.update(schema.holdings)
      .set({ quantity: Math.trunc((h.quantity * num) / den) })
      .where(
        and(
          eq(schema.holdings.accountId, h.accountId),
          eq(schema.holdings.instrumentId, h.instrumentId),
        ),
      )
      .run()
  }
}

const bumpHolding = (
  db: DrizzleClient,
  accountId: InvestmentAccountId,
  instrumentId: InstrumentId,
  deltaQty: number,
  deltaBasis: number,
  currency: string,
): void => {
  const existing = db
    .select()
    .from(schema.holdings)
    .where(
      and(
        eq(schema.holdings.accountId, accountId),
        eq(schema.holdings.instrumentId, instrumentId),
      ),
    )
    .get()
  if (existing === undefined) {
    db.insert(schema.holdings)
      .values({
        accountId,
        instrumentId,
        quantity: deltaQty,
        costBasisMinor: deltaBasis,
        currency,
      })
      .run()
    return
  }
  const nextQty = existing.quantity + deltaQty
  const nextBasis = existing.costBasisMinor + deltaBasis
  if (nextQty === 0) {
    // Zeroed-out position: drop the row so UI "current holdings" stays clean.
    // The underlying lots row stays in place for cost-basis history.
    db.delete(schema.holdings)
      .where(
        and(
          eq(schema.holdings.accountId, accountId),
          eq(schema.holdings.instrumentId, instrumentId),
        ),
      )
      .run()
    return
  }
  db.update(schema.holdings)
    .set({ quantity: nextQty, costBasisMinor: nextBasis })
    .where(
      and(
        eq(schema.holdings.accountId, accountId),
        eq(schema.holdings.instrumentId, instrumentId),
      ),
    )
    .run()
}
