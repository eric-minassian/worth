import { Link } from "@tanstack/react-router"
import { LayoutDashboard, ListOrdered, Tag, Wallet } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@worth/ui"

interface LayoutProps {
  readonly children: ReactNode
}

interface NavItem {
  readonly to: "/" | "/accounts" | "/transactions" | "/categories"
  readonly label: string
  readonly Icon: typeof LayoutDashboard
}

const navItems: readonly NavItem[] = [
  { to: "/", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/accounts", label: "Accounts", Icon: Wallet },
  { to: "/transactions", label: "Transactions", Icon: ListOrdered },
  { to: "/categories", label: "Categories", Icon: Tag },
]

export const Layout = ({ children }: LayoutProps) => (
  <div className="flex h-full">
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-neutral-900 bg-neutral-950 px-3 py-5">
      <div className="px-3 pb-5">
        <h1 className="text-xl font-semibold tracking-tight">Worth</h1>
      </div>
      <nav className="flex flex-col gap-0.5">
        {navItems.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="group flex items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100 data-[status=active]:bg-neutral-900 data-[status=active]:text-neutral-100"
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn("h-4 w-4", isActive ? "text-neutral-100" : "text-neutral-500")}
                />
                {label}
              </>
            )}
          </Link>
        ))}
      </nav>
    </aside>
    <main className="flex-1 overflow-auto">{children}</main>
  </div>
)
