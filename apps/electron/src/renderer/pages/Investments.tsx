import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Receipt } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"

import type {
  CurrencyCode,
  Instrument,
  InstrumentId,
  InstrumentKind,
  InvestmentAccount,
  InvestmentAccountId,
  InvestmentTransactionKind,
  Money,
  Quantity,
} from "@worth/domain"
import {
  Badge,
  Button,
  Card,
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
  cashBalancesQuery,
  holdingsQuery,
  instrumentsQuery,
  invalidationKeys,
  investmentAccountsQuery,
  investmentTransactionsQuery,
} from "../lib/queries"
import {
  amountClass,
  formatDate,
  formatMoney,
  formatQuantity,
  INSTRUMENT_KIND_LABEL,
  QUANTITY_SCALE,
  parseMoneyMinor,
  parseQuantityInput,
  toDateInput,
  fromDateInput,
} from "../lib/format"
import { PageActions } from "../Layout"
import { TableSkeletonRows } from "../components/TableSkeletonRows"

const COMMON_CURRENCIES: readonly CurrencyCode[] = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
].map((c) => c as CurrencyCode)

const INSTRUMENT_KINDS: readonly InstrumentKind[] = [
  "stock",
  "etf",
  "mutual_fund",
  "bond",
  "crypto",
  "cash",
  "other",
]

const TXN_KINDS: readonly { value: InvestmentTransactionKind; label: string }[] = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "dividend", label: "Dividend" },
]

export const InvestmentsPage = () => {
  const accounts = useQuery(investmentAccountsQuery)
  const holdings = useQuery(holdingsQuery(undefined))
  const cashBalances = useQuery(cashBalancesQuery(undefined))
  const instruments = useQuery(instrumentsQuery)
  const recentTxns = useQuery(
    investmentTransactionsQuery({
      accountId: undefined,
      instrumentId: undefined,
      kind: undefined,
      limit: 25,
      order: "posted-desc",
    }),
  )
  const [accountOpen, setAccountOpen] = useState(false)
  const [recordOpen, setRecordOpen] = useState(false)

  const instrumentById = useMemo(() => {
    const m = new Map<InstrumentId, Instrument>()
    for (const i of instruments.data ?? []) m.set(i.id, i)
    return m
  }, [instruments.data])

  const accountById = useMemo(() => {
    const m = new Map<InvestmentAccountId, InvestmentAccount>()
    for (const a of accounts.data ?? []) m.set(a.id, a)
    return m
  }, [accounts.data])

  const totalCostBasisByCurrency = useMemo(() => {
    const m = new Map<CurrencyCode, bigint>()
    for (const h of holdings.data ?? []) {
      m.set(
        h.costBasis.currency,
        (m.get(h.costBasis.currency) ?? 0n) + h.costBasis.minor,
      )
    }
    return m
  }, [holdings.data])

  const hasAccount = (accounts.data?.length ?? 0) > 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
      <PageActions>
        <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="secondary">
              <Plus /> Add account
            </Button>
          </DialogTrigger>
          <InvestmentAccountDialog onClose={() => setAccountOpen(false)} />
        </Dialog>
        <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!hasAccount}>
              <Receipt /> Record transaction
            </Button>
          </DialogTrigger>
          <RecordInvestmentDialog
            accounts={accounts.data ?? []}
            instruments={instruments.data ?? []}
            onClose={() => setRecordOpen(false)}
          />
        </Dialog>
      </PageActions>

      {hasAccount && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription className="text-xs">Accounts</CardDescription>
              <CardTitle className="text-base tabular-nums">
                {accounts.data?.length ?? 0}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription className="text-xs">Positions</CardDescription>
              <CardTitle className="text-base tabular-nums">
                {holdings.data?.length ?? 0}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription className="text-xs">
                Total cost basis
              </CardDescription>
              <CardTitle className="text-base tabular-nums">
                {[...totalCostBasisByCurrency.entries()].map(
                  ([currency, minor]) => (
                    <div key={currency}>
                      {formatMoney({ minor, currency })}
                    </div>
                  ),
                )}
                {totalCostBasisByCurrency.size === 0 && "—"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription className="text-xs">Cash</CardDescription>
              <CardTitle className="text-base tabular-nums">
                {(() => {
                  const byCurrency = new Map<CurrencyCode, bigint>()
                  for (const b of cashBalances.data ?? []) {
                    byCurrency.set(
                      b.currency,
                      (byCurrency.get(b.currency) ?? 0n) + b.minor,
                    )
                  }
                  if (byCurrency.size === 0) return "—"
                  return [...byCurrency.entries()].map(([currency, minor]) => (
                    <div key={currency}>
                      {formatMoney({ minor, currency })}
                    </div>
                  ))
                })()}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Accounts</h2>
        </div>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Institution</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.isPending ? (
                <TableSkeletonRows cols={4} rows={2} />
              ) : accounts.data && accounts.data.length > 0 ? (
                accounts.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.institution ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.currency}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(a.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-xs text-muted-foreground"
                  >
                    No investment accounts yet. Add one to start recording
                    trades.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Holdings</h2>
        </div>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Cost basis</TableHead>
                <TableHead className="text-right">Avg cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.isPending ? (
                <TableSkeletonRows cols={6} rows={3} />
              ) : holdings.data && holdings.data.length > 0 ? (
                holdings.data.map((h) => {
                  const instrument = instrumentById.get(h.instrumentId)
                  const account = accountById.get(h.accountId)
                  const avgCost =
                    h.quantity > 0n
                      ? (h.costBasis.minor * QUANTITY_SCALE) / h.quantity
                      : 0n
                  return (
                    <TableRow key={`${h.accountId}:${h.instrumentId}`}>
                      <TableCell className="font-medium">
                        {instrument?.symbol ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span>{instrument?.name ?? h.instrumentId}</span>
                          {instrument && (
                            <Badge
                              variant="outline"
                              className="font-normal text-[10px]"
                            >
                              {INSTRUMENT_KIND_LABEL[instrument.kind]}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {account?.name ?? h.accountId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQuantity(h.quantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(h.costBasis)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {formatMoney({
                          minor: avgCost,
                          currency: h.costBasis.currency,
                        })}
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
                    No open positions. Record a buy to see it here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {(cashBalances.data ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Cash balances</h2>
          </div>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashBalances.data?.map((b) => {
                  const account = accountById.get(b.accountId)
                  return (
                    <TableRow key={`${b.accountId}:${b.currency}`}>
                      <TableCell className="text-xs">
                        {account?.name ?? b.accountId}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.currency}
                      </TableCell>
                      <TableCell
                        className={
                          b.minor < 0n
                            ? "text-right font-medium tabular-nums text-destructive"
                            : "text-right font-medium tabular-nums"
                        }
                      >
                        {formatMoney({ minor: b.minor, currency: b.currency })}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent transactions</h2>
        </div>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentTxns.isPending ? (
                <TableSkeletonRows cols={7} rows={4} />
              ) : recentTxns.data && recentTxns.data.length > 0 ? (
                recentTxns.data.map((t) => {
                  const instrument = t.instrumentId
                    ? instrumentById.get(t.instrumentId)
                    : null
                  const account = accountById.get(t.accountId)
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(t.postedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {t.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {instrument?.symbol ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {account?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {t.quantity !== null ? formatQuantity(t.quantity) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {t.pricePerShare ? formatMoney(t.pricePerShare) : "—"}
                      </TableCell>
                      <TableCell className={amountClass(t.amount.minor)}>
                        {formatMoney(t.amount)}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-xs text-muted-foreground"
                  >
                    No transactions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

// -- Investment account dialog ---------------------------------------------

const InvestmentAccountDialog = ({ onClose }: { readonly onClose: () => void }) => {
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [institution, setInstitution] = useState("")
  const [currency, setCurrency] = useState<CurrencyCode>("USD" as CurrencyCode)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      callCommand("investmentAccount.create", {
        name: name.trim(),
        institution: institution.trim() === "" ? null : institution.trim(),
        currency,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.investmentAccounts })
      toast.success(`Created ${name.trim()}`)
      setName("")
      setInstitution("")
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
          <DialogTitle>New investment account</DialogTitle>
          <DialogDescription>
            A brokerage or retirement account that holds instruments.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="inv-name">Name</Label>
          <Input
            id="inv-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fidelity Brokerage"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-institution">Institution</Label>
            <Input
              id="inv-institution"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="Fidelity (optional)"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-currency">Currency</Label>
            <Select
              value={currency}
              onValueChange={(v) => setCurrency(v as CurrencyCode)}
            >
              <SelectTrigger id="inv-currency">
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

// -- Record investment transaction dialog -----------------------------------

interface RecordInvestmentDialogProps {
  readonly accounts: readonly { readonly id: InvestmentAccountId; readonly name: string; readonly currency: CurrencyCode }[]
  readonly instruments: readonly {
    readonly id: InstrumentId
    readonly symbol: string
    readonly name: string
    readonly kind: InstrumentKind
    readonly currency: CurrencyCode
  }[]
  readonly onClose: () => void
}

const RecordInvestmentDialog = ({
  accounts,
  instruments,
  onClose,
}: RecordInvestmentDialogProps) => {
  const qc = useQueryClient()
  const [kind, setKind] = useState<InvestmentTransactionKind>("buy")
  const [accountId, setAccountId] = useState<InvestmentAccountId | "">(
    accounts[0]?.id ?? "",
  )
  const [postedAt, setPostedAt] = useState(toDateInput(Date.now()))

  const [instrumentMode, setInstrumentMode] = useState<"existing" | "new">(
    instruments.length > 0 ? "existing" : "new",
  )
  const [instrumentId, setInstrumentId] = useState<InstrumentId | "">(
    instruments[0]?.id ?? "",
  )
  const [newSymbol, setNewSymbol] = useState("")
  const [newName, setNewName] = useState("")
  const [newKind, setNewKind] = useState<InstrumentKind>("stock")

  const [quantity, setQuantity] = useState("")
  const [price, setPrice] = useState("")
  const [fees, setFees] = useState("")
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string | null>(null)

  const currency: CurrencyCode =
    accounts.find((a) => a.id === accountId)?.currency ??
    ("USD" as CurrencyCode)

  const mutation = useMutation({
    mutationFn: async () => {
      if (accountId === "") throw new Error("Account is required")
      const postedAtMs = fromDateInput(postedAt)

      let resolvedInstrumentId: InstrumentId
      if (instrumentMode === "existing") {
        if (instrumentId === "") throw new Error("Instrument is required")
        resolvedInstrumentId = instrumentId
      } else {
        if (newSymbol.trim().length === 0)
          throw new Error("Symbol is required")
        const created = await callCommand("instrument.create", {
          symbol: newSymbol.trim().toUpperCase(),
          name: newName.trim() === "" ? newSymbol.trim().toUpperCase() : newName.trim(),
          kind: newKind,
          currency,
        })
        resolvedInstrumentId = created.id
      }

      if (kind === "dividend") {
        const amountMinor = parseMoneyMinor(amount)
        if (amountMinor === null)
          throw new Error("Amount must be a decimal like 25.00")
        await callCommand("investment.dividend", {
          accountId,
          instrumentId: resolvedInstrumentId,
          postedAt: postedAtMs,
          amount: { minor: amountMinor, currency },
        })
        return
      }

      const qtyMinor = parseQuantityInput(quantity)
      const priceMinor = parseMoneyMinor(price)
      if (qtyMinor === null || qtyMinor <= 0n)
        throw new Error("Quantity must be a positive number")
      if (priceMinor === null || priceMinor <= 0n)
        throw new Error("Price must be a positive decimal")
      const feesMinor =
        fees.trim() === "" ? 0n : parseMoneyMinor(fees) ?? -1n
      if (feesMinor < 0n)
        throw new Error("Fees must be a non-negative decimal")

      const payload = {
        accountId,
        instrumentId: resolvedInstrumentId,
        postedAt: postedAtMs,
        quantity: qtyMinor as Quantity,
        pricePerShare: { minor: priceMinor, currency },
        fees: { minor: feesMinor, currency } as Money,
      }
      if (kind === "buy") await callCommand("investment.buy", payload)
      else await callCommand("investment.sell", payload)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: invalidationKeys.holdings }),
        qc.invalidateQueries({ queryKey: invalidationKeys.cashBalances }),
        qc.invalidateQueries({
          queryKey: invalidationKeys.investmentTransactions,
        }),
        qc.invalidateQueries({ queryKey: invalidationKeys.instruments }),
      ])
      toast.success(`Recorded ${kind}`)
      onClose()
    },
    onError: (e) => setError(formatRpcError(e)),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    mutation.mutate()
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Record investment transaction</DialogTitle>
          <DialogDescription>
            Buy, sell, or dividend. Cost basis is computed automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label>Kind</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as InvestmentTransactionKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TXN_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={postedAt}
              onChange={(e) => setPostedAt(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Account</Label>
          <Select
            value={accountId}
            onValueChange={(v) => setAccountId(v as InvestmentAccountId)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select account" />
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

        <Separator />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Instrument</Label>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              onClick={() =>
                setInstrumentMode((m) => (m === "existing" ? "new" : "existing"))
              }
            >
              {instrumentMode === "existing" ? "+ Add new" : "Pick existing"}
            </Button>
          </div>
          {instrumentMode === "existing" ? (
            <Select
              value={instrumentId}
              onValueChange={(v) => setInstrumentId(v as InstrumentId)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select instrument" />
              </SelectTrigger>
              <SelectContent>
                {instruments.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.symbol} — {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                placeholder="VTI"
              />
              <Input
                className="col-span-2"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Vanguard Total Stock Market"
              />
              <Select
                value={newKind}
                onValueChange={(v) => setNewKind(v as InstrumentKind)}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSTRUMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {INSTRUMENT_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Separator />

        {kind === "dividend" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Amount ({currency})</Label>
            <Input
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
              inputMode="decimal"
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="10"
                inputMode="decimal"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="price">Price / share</Label>
              <Input
                id="price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="200.00"
                inputMode="decimal"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fees">Fees</Label>
              <Input
                id="fees"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                placeholder="0"
                inputMode="decimal"
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Recording…" : "Record"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

