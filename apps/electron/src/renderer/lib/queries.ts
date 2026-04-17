import { queryOptions } from "@tanstack/react-query"
import type { AccountId } from "@worth/domain"
import type { InputOf } from "@worth/ipc"
import { callCommand } from "../rpc"

export const accountsQuery = queryOptions({
  queryKey: ["account.list"] as const,
  queryFn: () => callCommand("account.list", {}),
  staleTime: 10_000,
})

export const categoriesQuery = queryOptions({
  queryKey: ["category.list"] as const,
  queryFn: () => callCommand("category.list", {}),
  staleTime: 10_000,
})

export const transactionsQuery = (filter: InputOf<"transaction.list">) =>
  queryOptions({
    queryKey: ["transaction.list", filter] as const,
    queryFn: () => callCommand("transaction.list", filter),
    staleTime: 5_000,
  })

export const invalidationKeys = {
  accounts: ["account.list"] as const,
  categories: ["category.list"] as const,
  transactions: ["transaction.list"] as const,
  transactionsForAccount: (accountId: AccountId) =>
    ["transaction.list", { accountId }] as const,
}
