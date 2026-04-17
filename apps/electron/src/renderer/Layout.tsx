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
  <div className="flex h-full bg-background text-foreground">
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-3 py-5 text-sidebar-foreground">
      <div className="px-3 pb-5">
        <h1 className="text-xl font-semibold tracking-tight">Worth</h1>
      </div>
      <nav className="flex flex-col gap-0.5">
        {navItems.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={cn(
              "group flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground",
            )}
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
    <main className="flex-1 overflow-auto">{children}</main>
  </div>
)
