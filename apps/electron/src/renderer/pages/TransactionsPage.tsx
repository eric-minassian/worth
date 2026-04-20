import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDownRight,
  ArrowUpRight,
  FileUp,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import {
  memo,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"

import type {
  AccountId,
  CategoryId,
  Transaction,
  TransactionId,
} from "@worth/domain"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  buttonVariants,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@worth/ui"
import { callCommand, formatRpcError } from "../rpc"
import { ImportDialog } from "./ImportDialog"
import { PageActions } from "../Layout"
import {
  accountsQuery,
  categoriesQuery,
  invalidationKeys,
  transactionsQuery,
} from "../lib/queries"
import {
  amountClass,
  formatDate,
  formatMoney,
  fromDateInput,
  parseMoneyMinor,
  toDateInput,
} from "../lib/format"

const ALL_ACCOUNTS = "__all_accounts__"
const ALL_CATEGORIES = "__all_categories__"
const UNCATEGORIZED = "__uncategorized__"

const ROW_HEIGHT = 48
const GRID_COLS =
  "grid-cols-[110px_minmax(0,1fr)_140px_170px_140px_36px]"

export const TransactionsPage = () => {
  const [accountFilter, setAccountFilter] = useState<string>(ALL_ACCOUNTS)
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES)
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const transactions = useQuery(
    transactionsQuery({
      accountId:
        accountFilter === ALL_ACCOUNTS ? undefined : (accountFilter as AccountId),
      search: deferredSearch.trim() === "" ? undefined : deferredSearch.trim(),
      limit: 1000,
      order: "posted-desc",
    }),
  )

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  )

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  )

  const filteredByCategory = useMemo(() => {
    const data = transactions.data ?? []
    if (categoryFilter === ALL_CATEGORIES) return data
    if (categoryFilter === UNCATEGORIZED)
      return data.filter((t) => t.categoryId === null)
    return data.filter((t) => t.categoryId === categoryFilter)
  }, [transactions.data, categoryFilter])

  const hasAccounts = (accounts.data?.length ?? 0) > 0
  const hasFilters =
    search.trim() !== "" ||
    accountFilter !== ALL_ACCOUNTS ||
    categoryFilter !== ALL_CATEGORIES

  const isLoading = transactions.isPending || accounts.isPending

  // Bounded height required; the virtualizer falls back to rendering the
  // full list without it.
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-8 py-6 h-[calc(100dvh-2.75rem)]">
      <PageActions>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" disabled={!hasAccounts}>
              <FileUp /> Import CSV
            </Button>
          </DialogTrigger>
          <ImportDialog
            accounts={accounts.data ?? []}
            onClose={() => setImportOpen(false)}
          />
        </Dialog>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!hasAccounts}>
              <Plus /> Add transaction
            </Button>
          </DialogTrigger>
          <TransactionDialog
            accounts={accounts.data ?? []}
            onClose={() => setOpen(false)}
          />
        </Dialog>
      </PageActions>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payee or memo…"
            className="h-7 pl-7"
          />
        </div>
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="h-7 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
            {accounts.data?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-7 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
            {categories.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("")
              setAccountFilter(ALL_ACCOUNTS)
              setCategoryFilter(ALL_CATEGORIES)
            }}
          >
            <X /> Reset
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {isLoading ? (
            <Skeleton className="h-3 w-16" />
          ) : (
            `${filteredByCategory.length} of ${transactions.data?.length ?? 0}`
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <div
          className={cn(
            "grid shrink-0 items-center border-b bg-card px-3 py-2 text-xs font-medium text-muted-foreground",
            GRID_COLS,
          )}
        >
          <span>Date</span>
          <span>Payee</span>
          <span>Account</span>
          <span>Category</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {isLoading ? (
          <TransactionListSkeleton />
        ) : filteredByCategory.length > 0 ? (
          <VirtualizedTransactionList
            transactions={filteredByCategory}
            accountById={accountById}
            categoryById={categoryById}
            categories={categories.data ?? []}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-xs text-muted-foreground">
            {hasAccounts
              ? "No transactions match. Add one or adjust filters."
              : "Create an account first, then add transactions."}
          </div>
        )}
      </div>
    </div>
  )
}

interface VirtualizedTransactionListProps {
  readonly transactions: readonly Transaction[]
  readonly accountById: ReadonlyMap<AccountId, { name: string }>
  readonly categoryById: ReadonlyMap<
    CategoryId,
    { name: string; color: string | null }
  >
  readonly categories: readonly { id: CategoryId; name: string }[]
}

const VirtualizedTransactionList = ({
  transactions,
  accountById,
  categoryById,
  categories,
}: VirtualizedTransactionListProps) => {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    getItemKey: (i) => transactions[i]?.id ?? i,
  })

  const items = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
      <div
        className="relative w-full"
        style={{ height: `${totalSize}px` }}
      >
        {items.map((virtualRow) => {
          const txn = transactions[virtualRow.index]
          if (!txn) return null
          const accountName = accountById.get(txn.accountId)?.name ?? "—"
          return (
            <TransactionRow
              key={virtualRow.key}
              txn={txn}
              accountName={accountName}
              categoryById={categoryById}
              categories={categories}
              size={virtualRow.size}
              start={virtualRow.start}
            />
          )
        })}
      </div>
    </div>
  )
}

interface TransactionRowProps {
  readonly txn: Transaction
  readonly accountName: string
  readonly categoryById: ReadonlyMap<
    CategoryId,
    { name: string; color: string | null }
  >
  readonly categories: readonly { id: CategoryId; name: string }[]
  readonly size: number
  readonly start: number
}

const TransactionRow = memo(function TransactionRow({
  txn,
  accountName,
  categoryById,
  categories,
  size,
  start,
}: TransactionRowProps) {
  return (
    <div
      className={cn(
        "group absolute top-0 left-0 grid w-full items-center border-b px-3 text-sm",
        GRID_COLS,
      )}
      style={{
        height: `${size}px`,
        transform: `translateY(${start}px)`,
      }}
    >
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDate(txn.postedAt)}
      </span>
      <div className="flex min-w-0 flex-col pr-2">
        <span className="truncate font-medium" title={txn.payee}>
          {txn.payee}
        </span>
        {txn.memo && (
          <span
            className="truncate text-xs text-muted-foreground"
            title={txn.memo}
          >
            {txn.memo}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <Badge
          variant="outline"
          className="max-w-full truncate font-normal"
        >
          {accountName}
        </Badge>
      </div>
      <div className="min-w-0">
        <CategoryPicker
          txnId={txn.id}
          value={txn.categoryId}
          categories={categories}
          categoryById={categoryById}
          accountId={txn.accountId}
        />
      </div>
      <span
        className={cn(
          amountClass(txn.amount.minor),
          "inline-flex items-center justify-end gap-1 pr-1",
        )}
      >
        {txn.amount.minor < 0n ? (
          <ArrowDownRight className="size-3" />
        ) : (
          <ArrowUpRight className="size-3" />
        )}
        {formatMoney(txn.amount)}
      </span>
      <TransactionRowMenu txnId={txn.id} payee={txn.payee} />
    </div>
  )
})

const TransactionListSkeleton = () => (
  <div className="flex min-h-0 flex-1 flex-col">
    {Array.from({ length: 12 }).map((_, i) => (
      <div
        key={i}
        className={cn(
          "grid items-center border-b px-3 py-3",
          GRID_COLS,
        )}
        style={{ height: ROW_HEIGHT }}
      >
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3 w-20 justify-self-end" />
        <span />
      </div>
    ))}
  </div>
)

interface CategoryPickerProps {
  readonly txnId: TransactionId
  readonly value: CategoryId | null
  readonly categories: readonly { id: CategoryId; name: string }[]
  readonly categoryById: ReadonlyMap<
    CategoryId,
    { name: string; color: string | null }
  >
  readonly accountId: AccountId
}

const CategoryPicker = ({
  txnId,
  value,
  categories,
  categoryById,
  accountId,
}: CategoryPickerProps) => {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (categoryId: CategoryId | null) =>
      callCommand("transaction.categorize", { id: txnId, categoryId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.transactions })
      await qc.invalidateQueries({
        queryKey: invalidationKeys.transactionsForAccount(accountId),
      })
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  const current = value ? categoryById.get(value) : null

  return (
    <Select
      value={value ?? UNCATEGORIZED}
      disabled={mutation.isPending}
      onValueChange={(v) =>
        mutation.mutate(v === UNCATEGORIZED ? null : (v as CategoryId))
      }
    >
      <SelectTrigger className="h-7 w-[160px] gap-1.5">
        {current ? (
          <span className="flex items-center gap-2">
            {current.color && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: current.color }}
              />
            )}
            <span className="truncate">{current.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Uncategorized</span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const TransactionRowMenu = ({
  txnId,
  payee,
}: {
  readonly txnId: TransactionId
  readonly payee: string
}) => {
  const qc = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const deleteMutation = useMutation({
    mutationFn: () => callCommand("transaction.delete", { id: txnId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.transactions })
      toast.success("Transaction deleted")
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="truncate max-w-[200px]">
            {payee}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmOpen(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes “{payee}” from your ledger. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface TransactionDialogProps {
  readonly accounts: readonly { id: AccountId; name: string; currency: string }[]
  readonly onClose: () => void
}

const TransactionDialog = ({ accounts, onClose }: TransactionDialogProps) => {
  const qc = useQueryClient()
  const firstAccountId = accounts[0]?.id
  const firstCurrency = accounts[0]?.currency ?? "USD"

  const [accountId, setAccountId] = useState<AccountId | undefined>(firstAccountId)
  const [date, setDate] = useState(toDateInput(Date.now()))
  const [amountText, setAmountText] = useState("")
  const [payee, setPayee] = useState("")
  const [memo, setMemo] = useState("")
  const [error, setError] = useState<string | null>(null)

  const selectedAccount = accounts.find((a) => a.id === accountId)
  const currency = selectedAccount?.currency ?? firstCurrency

  const mutation = useMutation({
    mutationFn: () => {
      if (!accountId) throw new Error("No account selected")
      const minor = parseMoneyMinor(amountText)
      if (minor === null) throw new Error("Invalid amount")
      return callCommand("transaction.create", {
        accountId,
        postedAt: fromDateInput(date),
        amount: { minor, currency: currency as never },
        payee: payee.trim(),
        memo: memo.trim() === "" ? null : memo.trim(),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.transactions })
      toast.success(`Added ${payee.trim()}`)
      setAmountText("")
      setPayee("")
      setMemo("")
      onClose()
    },
    onError: (e) => setError(formatRpcError(e)),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!accountId) {
      setError("Select an account")
      return
    }
    if (payee.trim().length === 0) {
      setError("Payee is required")
      return
    }
    if (parseMoneyMinor(amountText) === null) {
      setError("Amount must be a number like -12.50 or 42")
      return
    }
    mutation.mutate()
  }

  return (
    <DialogContent>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>New transaction</DialogTitle>
          <DialogDescription>
            Negative amounts are outflows; positive amounts are inflows.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="txn-account">Account</Label>
          <Select
            value={accountId ?? ""}
            onValueChange={(v) => setAccountId(v as AccountId)}
          >
            <SelectTrigger id="txn-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-date">Date</Label>
            <Input
              id="txn-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-amount">Amount ({currency})</Label>
            <Input
              id="txn-amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="-12.50"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="txn-payee">Payee</Label>
          <Input
            id="txn-payee"
            autoFocus
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="Whole Foods"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="txn-memo">Memo</Label>
          <Input
            id="txn-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Optional"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Add transaction"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
