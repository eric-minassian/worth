import { randomUUID } from "node:crypto"
import type {
  AccountId,
  CategoryId,
  DeviceId,
  EventId,
  TransactionId,
} from "@worth/domain"

export const newAccountId = (): AccountId => randomUUID() as AccountId
export const newCategoryId = (): CategoryId => randomUUID() as CategoryId
export const newTransactionId = (): TransactionId => randomUUID() as TransactionId
export const newEventId = (): EventId => randomUUID() as EventId
export const newDeviceId = (): DeviceId => randomUUID() as DeviceId
