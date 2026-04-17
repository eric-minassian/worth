import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@worth/ui"
import { callCommand, RpcError } from "../rpc"
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

export const TransactionsPage = () => {
  const [accountFilter, setAccountFilter] = useState<AccountId | "">("")
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)

  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const transactions = useQuery(
    transactionsQuery({
      accountId: accountFilter === "" ? undefined : accountFilter,
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
          <p className="mt-1 text-sm text-neutral-400">
            Every entry in your ledger. Add manually for now; CSV import lands in M2.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={!hasAccounts}>
              <Plus className="h-4 w-4" /> Add transaction
            </Button>
          </DialogTrigger>
          <TransactionDialog
            accounts={accounts.data ?? []}
            onClose={() => setOpen(false)}
          />
        </Dialog>
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-filter">Account</Label>
          <Select
            id="account-filter"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value as AccountId | "")}
          >
            <option value="">All accounts</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-950">
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
                  <TableCell className="text-neutral-400">{formatDate(txn.postedAt)}</TableCell>
                  <TableCell className="font-medium">{txn.payee}</TableCell>
                  <TableCell className="text-neutral-400">
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
                    className={`text-right font-medium ${
                      txn.amount.minor < 0n ? "text-red-400" : "text-emerald-400"
                    }`}
                  >
                    {formatMoney(txn.amount)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-neutral-500">
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
      value={value ?? ""}
      disabled={mutation.isPending}
      onChange={(e) => {
        const next = e.target.value
        mutation.mutate(next === "" ? null : (next as CategoryId))
      }}
    >
      <option value="">Uncategorized</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
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
  const currency = (selectedAccount?.currency ?? firstCurrency) as string

  const mutation = useMutation({
    mutationFn: () => {
      if (!accountId) throw new Error("No account selected")
      const minor = parseMoneyMinor(amountText)
      if (minor === null) throw new Error("Invalid amount")
      return callCommand("transaction.create", {
        accountId,
        postedAt: fromDateInput(date),
        amount: {
          minor,
          currency: currency as never, // branded; schema validates on main
        },
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
            id="txn-account"
            value={accountId ?? ""}
            onChange={(e) => setAccountId((e.target.value || undefined) as AccountId | undefined)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
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

        {error && <p className="text-sm text-red-400">{error}</p>}

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
