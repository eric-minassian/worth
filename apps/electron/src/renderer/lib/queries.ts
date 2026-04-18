import { queryOptions } from "@tanstack/react-query"
import type { AccountId, InvestmentAccountId } from "@worth/domain"
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

export const investmentAccountsQuery = queryOptions({
  queryKey: ["investmentAccount.list"] as const,
  queryFn: () => callCommand("investmentAccount.list", {}),
  staleTime: 10_000,
})

export const instrumentsQuery = queryOptions({
  queryKey: ["instrument.list"] as const,
  queryFn: () => callCommand("instrument.list", {}),
  staleTime: 10_000,
})

export const holdingsQuery = (
  accountId?: InvestmentAccountId | undefined,
) =>
  queryOptions({
    queryKey: ["investmentAccount.listHoldings", { accountId }] as const,
    queryFn: () =>
      callCommand("investmentAccount.listHoldings", { accountId }),
    staleTime: 5_000,
  })

export const cashBalancesQuery = (
  accountId?: InvestmentAccountId | undefined,
) =>
  queryOptions({
    queryKey: ["investmentAccount.listCashBalances", { accountId }] as const,
    queryFn: () =>
      callCommand("investmentAccount.listCashBalances", { accountId }),
    staleTime: 5_000,
  })

export const investmentTransactionsQuery = (
  filter: InputOf<"investment.list">,
) =>
  queryOptions({
    queryKey: ["investment.list", filter] as const,
    queryFn: () => callCommand("investment.list", filter),
    staleTime: 5_000,
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
