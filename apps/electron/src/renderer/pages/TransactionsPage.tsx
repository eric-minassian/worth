import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileUp, Plus } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"
import type { AccountId, CategoryId, TransactionId } from "@worth/domain"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@worth/ui"
import { callCommand, RpcError } from "../rpc"
import { ImportDialog } from "./ImportDialog"
import {
  accountsQuery,
  categoriesQuery,
  invalidationKeys,
  transactionsQuery,
} from "../lib/queries"
import {
  formatDate,
  formatMoney,
  fromDateInput,
  parseMoneyMinor,
  toDateInput,
} from "../lib/format"

const ALL_ACCOUNTS = "__all__"
const UNCATEGORIZED = "__uncategorized__"

export const TransactionsPage = () => {
  const [accountFilter, setAccountFilter] = useState<string>(ALL_ACCOUNTS)
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const transactions = useQuery(
    transactionsQuery({
      accountId: accountFilter === ALL_ACCOUNTS ? undefined : (accountFilter as AccountId),
      search: search.trim() === "" ? undefined : search.trim(),
      limit: 500,
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

  const hasAccounts = (accounts.data?.length ?? 0) > 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Transactions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every entry in your ledger. Add manually or import a bank CSV.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" disabled={!hasAccounts}>
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
              <Button disabled={!hasAccounts}>
                <Plus /> Add transaction
              </Button>
            </DialogTrigger>
            <TransactionDialog
              accounts={accounts.data ?? []}
              onClose={() => setOpen(false)}
            />
          </Dialog>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Payee or memo…"
          />
        </div>
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="account-filter">Account</Label>
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger id="account-filter">
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
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.data && transactions.data.length > 0 ? (
              transactions.data.map((txn) => (
                <TableRow key={txn.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDate(txn.postedAt)}
                  </TableCell>
                  <TableCell className="font-medium">{txn.payee}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {accountById.get(txn.accountId)?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <CategoryPicker
                      txnId={txn.id}
                      value={txn.categoryId}
                      categories={categories.data ?? []}
                      accountId={txn.accountId}
                    />
                  </TableCell>
                  <TableCell
                    className={cnAmount(txn.amount.minor)}
                  >
                    {formatMoney(txn.amount)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {hasAccounts
                    ? "No transactions match. Add one or adjust filters."
                    : "Create an account first, then add transactions."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {categoryById.size === 0 && categories.data ? null : null}
    </div>
  )
}

const cnAmount = (minor: bigint): string =>
  minor < 0n
    ? "text-right font-medium text-destructive"
    : "text-right font-medium text-emerald-500 dark:text-emerald-400"

interface CategoryPickerProps {
  readonly txnId: TransactionId
  readonly value: CategoryId | null
  readonly categories: readonly { id: CategoryId; name: string }[]
  readonly accountId: AccountId
}

const CategoryPicker = ({ txnId, value, categories, accountId }: CategoryPickerProps) => {
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
  })

  return (
    <Select
      value={value ?? UNCATEGORIZED}
      disabled={mutation.isPending}
      onValueChange={(v) => mutation.mutate(v === UNCATEGORIZED ? null : (v as CategoryId))}
    >
      <SelectTrigger>
        <SelectValue />
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
      setAmountText("")
      setPayee("")
      setMemo("")
      onClose()
    },
    onError: (e) => setError(e instanceof RpcError ? `${e.tag}: ${e.message}` : e.message),
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

        {error && <p className="text-sm text-destructive">{error}</p>}

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
