import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import {
  ArrowLeftRight,
  Copy,
  LayoutDashboard,
  Settings,
  Tag,
  Wallet,
} from "lucide-react"
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import {
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  Toaster,
  TooltipProvider,
  useSidebar,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@worth/ui"
import { useQuery } from "@tanstack/react-query"
import { accountsQuery, categoriesQuery } from "./lib/queries"
import { WorthMark } from "./components/WorthMark"

interface LayoutProps {
  readonly children: ReactNode
}

type NavPath =
  | "/"
  | "/accounts"
  | "/transactions"
  | "/duplicates"
  | "/categories"
  | "/settings"

interface NavItem {
  readonly to: NavPath
  readonly label: string
  readonly Icon: typeof LayoutDashboard
  readonly shortcut?: string
}

const navItems: readonly NavItem[] = [
  { to: "/", label: "Dashboard", Icon: LayoutDashboard, shortcut: "1" },
  { to: "/accounts", label: "Accounts", Icon: Wallet, shortcut: "2" },
  { to: "/transactions", label: "Transactions", Icon: ArrowLeftRight, shortcut: "3" },
  { to: "/categories", label: "Categories", Icon: Tag, shortcut: "4" },
  { to: "/duplicates", label: "Duplicates", Icon: Copy, shortcut: "5" },
]

const settingsItem: NavItem = {
  to: "/settings",
  label: "Settings",
  Icon: Settings,
}

const ROUTE_TITLES: Record<NavPath, string> = {
  "/": "Dashboard",
  "/accounts": "Accounts",
  "/transactions": "Transactions",
  "/duplicates": "Duplicates",
  "/categories": "Categories",
  "/settings": "Settings",
}

const dragStyle: CSSProperties = { WebkitAppRegion: "drag" } as CSSProperties
const noDragStyle: CSSProperties = { WebkitAppRegion: "no-drag" } as CSSProperties

// Pages teleport their primary actions into the top bar via this context.
// Avoids prop-drilling and keeps each page's actions co-located with the
// state they depend on.
const PageActionsContext = createContext<HTMLElement | null>(null)

export const PageActions = ({ children }: { children: ReactNode }) => {
  const target = useContext(PageActionsContext)
  if (!target) return null
  return createPortal(children, target)
}

export const Layout = ({ children }: LayoutProps) => {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null)
  const isMac = window.worth.platform === "darwin"

  const router = useRouter()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      // Don't steal nav shortcuts while the user is typing — they may want
      // native behavior (e.g. Cmd+A to select) inside inputs/textareas.
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable) return
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      const navItem = navItems.find((n) => n.shortcut === key)
      if (navItem) {
        e.preventDefault()
        void router.navigate({ to: navItem.to })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [router])

  return (
    <TooltipProvider delayDuration={150}>
      <SidebarProvider>
        <Sidebar collapsible={isMac ? "offcanvas" : "icon"}>
          <SidebarHeader
            className={isMac ? "pt-10" : undefined}
            style={isMac ? dragStyle : undefined}
          >
            <div
              className="flex items-center gap-2 px-1 py-1"
              style={noDragStyle}
            >
              <WorthMark className="size-5 shrink-0 rounded" />
              <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                Worth
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map(({ to, label, Icon }) => (
                    <NavMenuItem key={to} to={to} label={label} Icon={Icon} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <NavMenuItem
                to={settingsItem.to}
                label={settingsItem.label}
                Icon={settingsItem.Icon}
              />
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <TopBar isMac={isMac} actionsRef={setActionsTarget} />
          <PageActionsContext.Provider value={actionsTarget}>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          </PageActionsContext.Provider>
        </SidebarInset>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}

const TopBar = ({
  isMac,
  actionsRef,
}: {
  isMac: boolean
  actionsRef: (el: HTMLElement | null) => void
}) => {
  const { state } = useSidebar()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const title =
    (ROUTE_TITLES as Record<string, string | undefined>)[path] ?? "Worth"
  // When the sidebar is fully hidden (offcanvas, collapsed), traffic lights
  // sit on the top bar; pad the left so the trigger doesn't clash with them.
  const needsTrafficLightPad = isMac && state === "collapsed"
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur",
        needsTrafficLightPad && "pl-20",
      )}
      style={dragStyle}
    >
      <div style={noDragStyle}>
        <SidebarTrigger />
      </div>
      <h1 className="text-sm font-semibold">{title}</h1>
      <div
        ref={actionsRef}
        className="ml-auto flex items-center gap-2"
        style={noDragStyle}
      />
    </header>
  )
}

const NavMenuItem = ({
  to,
  label,
  Icon,
}: {
  to: NavPath
  label: string
  Icon: typeof LayoutDashboard
}) => {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const isActive = to === "/" ? path === "/" : path.startsWith(to)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link to={to}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

const CommandPalette = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const router = useRouter()
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)

  const navigate = (to: NavPath) => {
    void router.navigate({ to })
    onOpenChange(false)
  }

  const accountItems = accounts.data ?? []
  const categoryItems = categories.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Quick navigation and search
        </DialogDescription>
        <Command className="rounded-md">
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Navigate">
              {navItems.map(({ to, label, Icon, shortcut }) => (
                <CommandItem
                  key={to}
                  onSelect={() => navigate(to)}
                  value={`nav ${label}`}
                >
                  <Icon />
                  <span>{label}</span>
                  {shortcut && (
                    <CommandShortcut>⌘{shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
              <CommandItem
                onSelect={() => navigate(settingsItem.to)}
                value="nav Settings"
              >
                <Settings />
                <span>Settings</span>
              </CommandItem>
            </CommandGroup>
            {accountItems.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Accounts">
                  {accountItems.map((a) => (
                    <CommandItem
                      key={a.id}
                      value={`account ${a.name}`}
                      onSelect={() => navigate("/accounts")}
                    >
                      <Wallet />
                      <span>{a.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground capitalize">
                        {a.type}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {categoryItems.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Categories">
                  {categoryItems.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`category ${c.name}`}
                      onSelect={() => navigate("/categories")}
                    >
                      <Tag />
                      <span>{c.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
