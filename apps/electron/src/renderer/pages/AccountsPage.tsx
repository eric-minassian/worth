import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState, type FormEvent } from "react"
import type { AccountType, CurrencyCode } from "@worth/domain"
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
import { accountsQuery, invalidationKeys } from "../lib/queries"
import { formatDate } from "../lib/format"

const accountTypes: readonly { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
]

export const AccountsPage = () => {
  const accounts = useQuery(accountsQuery)
  const [open, setOpen] = useState(false)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every bucket of money you want to track — checking, savings, credit, cash.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> Add account
            </Button>
          </DialogTrigger>
          <AccountDialog onClose={() => setOpen(false)} />
        </Dialog>
      </header>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.data && accounts.data.length > 0 ? (
              accounts.data.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {account.type}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{account.currency}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(account.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
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
    mutationFn: () => callCommand("account.create", { name: name.trim(), type, currency }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.accounts })
      setName("")
      onClose()
    },
    onError: (e) => {
      setError(e instanceof RpcError ? `${e.tag}: ${e.message}` : String(e))
    },
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
            Accounts hold transactions. You can archive an account later — transactions stay.
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="type">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accountTypes.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase() as CurrencyCode)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
