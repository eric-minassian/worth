import { randomUUID } from "node:crypto"
import type {
  AccountId,
  CategoryId,
  DeviceId,
  EventId,
  InstrumentId,
  InvestmentAccountId,
  InvestmentTransactionId,
  TransactionId,
} from "@worth/domain"

export const newAccountId = (): AccountId => randomUUID() as AccountId
export const newCategoryId = (): CategoryId => randomUUID() as CategoryId
export const newTransactionId = (): TransactionId => randomUUID() as TransactionId
export const newEventId = (): EventId => randomUUID() as EventId
export const newDeviceId = (): DeviceId => randomUUID() as DeviceId
export const newInstrumentId = (): InstrumentId => randomUUID() as InstrumentId
export const newInvestmentAccountId = (): InvestmentAccountId =>
  randomUUID() as InvestmentAccountId
export const newInvestmentTransactionId = (): InvestmentTransactionId =>
  randomUUID() as InvestmentTransactionId
