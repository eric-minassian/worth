import { Schema } from "effect"

// -- Branded identifiers ----------------------------------------------------
//
// Each id is a ULID emitted by the client. No server-assigned ids at the
// domain layer — that keeps offline creation + later sync trivial.

export const AccountId = Schema.String.pipe(Schema.brand("AccountId"))
export type AccountId = Schema.Schema.Type<typeof AccountId>

export const TransactionId = Schema.String.pipe(Schema.brand("TransactionId"))
export type TransactionId = Schema.Schema.Type<typeof TransactionId>

export const CategoryId = Schema.String.pipe(Schema.brand("CategoryId"))
export type CategoryId = Schema.Schema.Type<typeof CategoryId>

export const EventId = Schema.String.pipe(Schema.brand("EventId"))
export type EventId = Schema.Schema.Type<typeof EventId>

export const DeviceId = Schema.String.pipe(Schema.brand("DeviceId"))
export type DeviceId = Schema.Schema.Type<typeof DeviceId>

/** Hybrid-logical-clock string, sortable as text. See @worth/sync for format. */
export const Hlc = Schema.String.pipe(Schema.brand("Hlc"))
export type Hlc = Schema.Schema.Type<typeof Hlc>

// -- Currency ---------------------------------------------------------------

export const CurrencyCode = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z]{3}$/)),
  Schema.brand("CurrencyCode"),
)
export type CurrencyCode = Schema.Schema.Type<typeof CurrencyCode>

export const USD: CurrencyCode = "USD" as CurrencyCode

// -- Money ------------------------------------------------------------------
//
// Amount in integer minor units. bigint is what we hold in memory; over the
// wire and in JSON event payloads it's encoded as a string to survive JSON.

export const Money = Schema.Struct({
  minor: Schema.BigIntFromString,
  currency: CurrencyCode,
})
export type Money = Schema.Schema.Type<typeof Money>

export const money = (minor: bigint, currency: CurrencyCode = USD): Money => ({
  minor,
  currency,
})
