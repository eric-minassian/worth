import { queryOptions } from "@tanstack/react-query"
import type { AccountId, InvestmentAccountId } from "@worth/domain"
import type { InputOf } from "@worth/ipc"
import { callCommand } from "../rpc"

// Mutations explicitly invalidate what they touch, so a long stale window
// is safe and keeps nav instant.
const STALE_MS = 60_000
const GC_MS = 10 * 60_000

export const accountsQuery = queryOptions({
  queryKey: ["account.list"] as const,
  queryFn: () => callCommand("account.list", {}),
  staleTime: STALE_MS,
  gcTime: GC_MS,
})

export const categoriesQuery = queryOptions({
  queryKey: ["category.list"] as const,
  queryFn: () => callCommand("category.list", {}),
  staleTime: STALE_MS,
  gcTime: GC_MS,
})

export const transactionsQuery = (filter: InputOf<"transaction.list">) =>
  queryOptions({
    queryKey: ["transaction.list", filter] as const,
    queryFn: () => callCommand("transaction.list", filter),
    staleTime: STALE_MS,
    gcTime: GC_MS,
  })

export const investmentAccountsQuery = queryOptions({
  queryKey: ["investmentAccount.list"] as const,
  queryFn: () => callCommand("investmentAccount.list", {}),
  staleTime: STALE_MS,
  gcTime: GC_MS,
})

export const instrumentsQuery = queryOptions({
  queryKey: ["instrument.list"] as const,
  queryFn: () => callCommand("instrument.list", {}),
  staleTime: STALE_MS,
  gcTime: GC_MS,
})

export const holdingsQuery = (
  accountId?: InvestmentAccountId | undefined,
) =>
  queryOptions({
    queryKey: ["investmentAccount.listHoldings", { accountId }] as const,
    queryFn: () =>
      callCommand("investmentAccount.listHoldings", { accountId }),
    staleTime: STALE_MS,
    gcTime: GC_MS,
  })

export const cashBalancesQuery = (
  accountId?: InvestmentAccountId | undefined,
) =>
  queryOptions({
    queryKey: ["investmentAccount.listCashBalances", { accountId }] as const,
    queryFn: () =>
      callCommand("investmentAccount.listCashBalances", { accountId }),
    staleTime: STALE_MS,
    gcTime: GC_MS,
  })

export const investmentTransactionsQuery = (
  filter: InputOf<"investment.list">,
) =>
  queryOptions({
    queryKey: ["investment.list", filter] as const,
    queryFn: () => callCommand("investment.list", filter),
    staleTime: STALE_MS,
    gcTime: GC_MS,
  })

export const invalidationKeys = {
  accounts: ["account.list"] as const,
  categories: ["category.list"] as const,
  transactions: ["transaction.list"] as const,
  transactionsForAccount: (accountId: AccountId) =>
    ["transaction.list", { accountId }] as const,
  investmentAccounts: ["investmentAccount.list"] as const,
  instruments: ["instrument.list"] as const,
  holdings: ["investmentAccount.listHoldings"] as const,
  cashBalances: ["investmentAccount.listCashBalances"] as const,
  investmentTransactions: ["investment.list"] as const,
}
