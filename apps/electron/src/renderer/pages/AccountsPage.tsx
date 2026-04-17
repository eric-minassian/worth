import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, MoreHorizontal, Pencil, Plus } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"

import type { AccountId, AccountType, CurrencyCode } from "@worth/domain"
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@worth/ui"
import { callCommand, formatRpcError } from "../rpc"
import {
  accountsQuery,
  invalidationKeys,
  transactionsQuery,
} from "../lib/queries"
import { ACCOUNT_TYPE_LABEL, formatDate, formatMoney } from "../lib/format"
import { PageActions } from "../Layout"

const ACCOUNT_TYPES: readonly AccountType[] = [
  "checking",
  "savings",
  "credit",
  "cash",
  "other",
]

const COMMON_CURRENCIES: readonly CurrencyCode[] = (
  [
    "USD",
    "EUR",
    "GBP",
    "CAD",
    "AUD",
    "JPY",
    "CHF",
    "CNY",
    "INR",
    "MXN",
    "BRL",
    "SGD",
  ] as readonly string[]
).map((c) => c as CurrencyCode)

export const AccountsPage = () => {
  const accounts = useQuery(accountsQuery)
  const allTxns = useQuery(
    transactionsQuery({
      accountId: undefined,
      search: undefined,
      limit: 5000,
      order: "posted-desc",
    }),
  )
  const [open, setOpen] = useState(false)

  const balances = useMemo(() => {
    const m = new Map<AccountId, bigint>()
    for (const t of allTxns.data ?? []) {
      m.set(t.accountId, (m.get(t.accountId) ?? 0n) + t.amount.minor)
    }
    return m
  }, [allTxns.data])

  const totalsByType = useMemo(() => {
    const m = new Map<AccountType, bigint>()
    for (const a of accounts.data ?? []) {
      m.set(a.type, (m.get(a.type) ?? 0n) + (balances.get(a.id) ?? 0n))
    }
    return m
  }, [accounts.data, balances])

  const primaryCurrency: CurrencyCode =
    accounts.data?.[0]?.currency ?? ("USD" as CurrencyCode)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
      <PageActions>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> Add account
            </Button>
          </DialogTrigger>
          <AccountDialog onClose={() => setOpen(false)} />
        </Dialog>
      </PageActions>

      {accounts.data && accounts.data.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ACCOUNT_TYPES.map((type) => {
            const sum = totalsByType.get(type) ?? 0n
            const count = (accounts.data ?? []).filter(
              (a) => a.type === type,
            ).length
            if (count === 0) return null
            return (
              <Card key={type}>
                <CardHeader>
                  <CardDescription className="text-xs">
                    {ACCOUNT_TYPE_LABEL[type]}
                  </CardDescription>
                  <CardTitle
                    className={
                      sum < 0n
                        ? "text-base tabular-nums text-destructive"
                        : "text-base tabular-nums"
                    }
                  >
                    {formatMoney({ minor: sum, currency: primaryCurrency })}
                  </CardTitle>
                </CardHeader>
                <Separator />
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {count} account{count === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-9" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.data && accounts.data.length > 0 ? (
              accounts.data.map((account) => {
                const bal = balances.get(account.id) ?? 0n
                return (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">{account.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {ACCOUNT_TYPE_LABEL[account.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {account.currency}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(account.createdAt)}
                    </TableCell>
                    <TableCell
                      className={
                        bal < 0n
                          ? "text-right font-medium tabular-nums text-destructive"
                          : "text-right font-medium tabular-nums"
                      }
                    >
                      {formatMoney({
                        minor: bal,
                        currency: account.currency,
                      })}
                    </TableCell>
                    <TableCell>
                      <AccountRowMenu
                        id={account.id}
                        name={account.name}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-xs text-muted-foreground"
                >
                  No accounts yet. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

const AccountRowMenu = ({
  id,
  name,
}: {
  readonly id: AccountId
  readonly name: string
}) => {
  const qc = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const archiveMutation = useMutation({
    mutationFn: () => callCommand("account.archive", { id }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.accounts })
      toast.success(`Archived ${name}`)
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
            <Archive /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Transactions stay linked. The account hides from new entries and
              filters. You can&rsquo;t undo this from the UI yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveMutation.mutate()}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RenameAccountDialog
        id={id}
        currentName={name}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
    </>
  )
}

const RenameAccountDialog = ({
  id,
  currentName,
  open,
  onOpenChange,
}: {
  readonly id: AccountId
  readonly currentName: string
  readonly open: boolean
  readonly onOpenChange: (v: boolean) => void
}) => {
  const qc = useQueryClient()
  const [name, setName] = useState(currentName)

  const mutation = useMutation({
    mutationFn: () => callCommand("account.rename", { id, name: name.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.accounts })
      toast.success("Account renamed")
      onOpenChange(false)
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim().length === 0) return
            mutation.mutate()
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Rename account</DialogTitle>
            <DialogDescription>
              Pick a new display name. History is preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename">Name</Label>
            <Input
              id="rename"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface AccountDialogProps {
  readonly onClose: () => void
}

const AccountDialog = ({ onClose }: AccountDialogProps) => {
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [type, setType] = useState<AccountType>("checking")
  const [currency, setCurrency] = useState<CurrencyCode>("USD" as CurrencyCode)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      callCommand("account.create", { name: name.trim(), type, currency }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.accounts })
      toast.success(`Created ${name.trim()}`)
      setName("")
      onClose()
    },
    onError: (e) => setError(formatRpcError(e)),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (name.trim().length === 0) {
      setError("Name is required")
      return
    }
    mutation.mutate()
  }

  return (
    <DialogContent>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            Accounts hold transactions. You can archive an account later —
            transactions stay.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Chase Checking"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACCOUNT_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="currency">Currency</Label>
            <Select
              value={currency}
              onValueChange={(v) => setCurrency(v as CurrencyCode)}
            >
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

