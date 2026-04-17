import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router"
import { Layout } from "./Layout"
import { Dashboard } from "./pages/Dashboard"
import { AccountsPage } from "./pages/AccountsPage"
import { TransactionsPage } from "./pages/TransactionsPage"
import { CategoriesPage } from "./pages/CategoriesPage"
import { SettingsPage } from "./pages/SettingsPage"

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
  component: Dashboard,
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: AccountsPage,
})

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  component: TransactionsPage,
})

const categoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/categories",
  component: CategoriesPage,
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
  categoriesRoute,
  settingsRoute,
])

export const router = createRouter({ routeTree, defaultPreload: "intent" })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
