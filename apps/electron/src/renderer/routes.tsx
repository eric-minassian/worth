import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"
import { Layout } from "./Layout"
import { Dashboard } from "./pages/Dashboard"
import { AccountsPage } from "./pages/AccountsPage"
import { TransactionsPage } from "./pages/TransactionsPage"
import { DuplicatesPage } from "./pages/DuplicatesPage"
import { CategoriesPage } from "./pages/CategoriesPage"
import { InvestmentsPage } from "./pages/Investments"
import { SettingsPage } from "./pages/SettingsPage"
import { queryClient } from "./lib/queryClient"
import {
  accountsQuery,
  cashBalancesQuery,
  categoriesQuery,
  holdingsQuery,
  instrumentsQuery,
  investmentAccountsQuery,
  investmentTransactionsQuery,
  transactionsQuery,
} from "./lib/queries"

// Loaders prefetch but never await — a cold cache still paints skeletons
// while the fetch populates the cache in the background.

const allTransactionsFilter = (limit: number) => ({
  accountId: undefined,
  search: undefined,
  limit,
  order: "posted-desc" as const,
})

const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: () => {
    void queryClient.prefetchQuery(accountsQuery)
    void queryClient.prefetchQuery(categoriesQuery)
    void queryClient.prefetchQuery(transactionsQuery(allTransactionsFilter(5000)))
  },
  component: Dashboard,
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  loader: () => {
    void queryClient.prefetchQuery(accountsQuery)
    void queryClient.prefetchQuery(transactionsQuery(allTransactionsFilter(5000)))
  },
  component: AccountsPage,
})

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  loader: () => {
    void queryClient.prefetchQuery(accountsQuery)
    void queryClient.prefetchQuery(categoriesQuery)
    void queryClient.prefetchQuery(transactionsQuery(allTransactionsFilter(1000)))
  },
  component: TransactionsPage,
})

const duplicatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/duplicates",
  loader: () => {
    void queryClient.prefetchQuery(accountsQuery)
  },
  component: DuplicatesPage,
})

const categoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/categories",
  loader: () => {
    void queryClient.prefetchQuery(categoriesQuery)
  },
  component: CategoriesPage,
})

const investmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/investments",
  loader: () => {
    void queryClient.prefetchQuery(investmentAccountsQuery)
    void queryClient.prefetchQuery(instrumentsQuery)
    void queryClient.prefetchQuery(holdingsQuery(undefined))
    void queryClient.prefetchQuery(cashBalancesQuery(undefined))
    void queryClient.prefetchQuery(
      investmentTransactionsQuery({
        accountId: undefined,
        instrumentId: undefined,
        kind: undefined,
        limit: 25,
        order: "posted-desc",
      }),
    )
  },
  component: InvestmentsPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  accountsRoute,
  transactionsRoute,
  duplicatesRoute,
  categoriesRoute,
  investmentsRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  history: createHashHistory(),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
