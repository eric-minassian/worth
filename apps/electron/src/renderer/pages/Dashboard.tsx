import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowDownRight,
  ArrowUpRight,
  ListOrdered,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { useMemo } from "react"
import type { AccountId, CategoryId, CurrencyCode, Money } from "@worth/domain"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@worth/ui"
import { accountsQuery, categoriesQuery, transactionsQuery } from "../lib/queries"
import { ACCOUNT_TYPE_LABEL, formatDate, formatMoney } from "../lib/format"
import { EmptyState } from "../components/EmptyState"

export const Dashboard = () => {
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const allTxns = useQuery(
    transactionsQuery({
      accountId: undefined,
      search: undefined,
      limit: 5000,
      order: "posted-desc",
    }),
  )

  const recent = (allTxns.data ?? []).slice(0, 8)

  const accountsById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  )
  const categoriesById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  )

  const balances = useBalancesByAccount(allTxns.data ?? [])
  const cashflow = useThisMonthCashflow(allTxns.data ?? [])
  const topCategories = useTopCategoriesThisMonth(
    allTxns.data ?? [],
    categoriesById,
  )

  const primaryCurrency: CurrencyCode =
    accounts.data?.[0]?.currency ?? ("USD" as CurrencyCode)

  const netWorth: Money = useMemo(() => {
    let total = 0n
    for (const v of balances.values()) total += v
    return { minor: total, currency: primaryCurrency }
  }, [balances, primaryCurrency])

  const isLoading = accounts.isLoading || allTxns.isLoading

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Net worth"
          value={isLoading ? null : formatMoney(netWorth)}
          hint={`${accounts.data?.length ?? 0} accounts`}
        />
        <SummaryCard
          label="This month income"
          value={
            isLoading
              ? null
              : formatMoney({ minor: cashflow.income, currency: primaryCurrency })
          }
          hint={`${cashflow.incomeCount} transactions`}
          tone="positive"
        />
        <SummaryCard
          label="This month spent"
          value={
            isLoading
              ? null
              : formatMoney({
                  minor: -cashflow.expense,
                  currency: primaryCurrency,
                })
          }
          hint={`${cashflow.expenseCount} transactions`}
          tone="negative"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Recent activity</CardTitle>
            <CardDescription className="text-xs">
              Last 8 transactions across all accounts.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {recent.length === 0 ? (
              <EmptyState
                Icon={ListOrdered}
                title="No transactions yet"
                hint="Add an account, then record or import transactions."
              />
            ) : (
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
                  {recent.map((txn) => {
                    const cat = txn.categoryId
                      ? categoriesById.get(txn.categoryId)
                      : null
                    return (
                      <TableRow key={txn.id}>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {formatDate(txn.postedAt)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {txn.payee}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {accountsById.get(txn.accountId)?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {cat ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              {cat.color && (
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: cat.color }}
                                />
                              )}
                              {cat.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={
                            txn.amount.minor < 0n
                              ? "text-right font-medium tabular-nums text-destructive"
                              : "text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            {txn.amount.minor < 0n ? (
                              <ArrowDownRight className="size-3" />
                            ) : (
                              <ArrowUpRight className="size-3" />
                            )}
                            {formatMoney(txn.amount)}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Accounts</CardTitle>
            <CardDescription className="text-xs">
              Running balance per account.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {accounts.data?.length
              ? accounts.data.map((a) => {
                  const bal = balances.get(a.id) ?? 0n
                  return (
                    <Link
                      key={a.id}
                      to="/transactions"
                      className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Wallet className="size-3" />
                        </span>
                        <div className="flex flex-col">
                          <span className="text-xs font-medium">{a.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {ACCOUNT_TYPE_LABEL[a.type]}
                          </span>
                        </div>
                      </div>
                      <span
                        className={
                          bal < 0n
                            ? "text-xs font-medium tabular-nums text-destructive"
                            : "text-xs font-medium tabular-nums"
                        }
                      >
                        {formatMoney({ minor: bal, currency: a.currency })}
                      </span>
                    </Link>
                  )
                })
              : (
                <EmptyState
                  Icon={Wallet}
                  title="No accounts"
                  hint="Add your first account to start tracking."
                  action={
                    <Button asChild size="xs" variant="secondary">
                      <Link to="/accounts">Add account</Link>
                    </Button>
                  }
                />
              )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top spending this month</CardTitle>
          <CardDescription className="text-xs">
            Where outflows landed since the 1st.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topCategories.length === 0 ? (
            <EmptyState
              Icon={TrendingUp}
              title="No outflows yet this month"
              hint="Once you record expenses, the largest categories show here."
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {topCategories.map((row) => (
                <li
                  key={row.id ?? "uncategorized"}
                  className="grid grid-cols-[120px_1fr_auto] items-center gap-3"
                >
                  <span className="flex items-center gap-2 truncate text-xs">
                    {row.color && (
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                    )}
                    <span className="truncate font-medium">{row.label}</span>
                  </span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatMoney({
                      minor: -row.minor,
                      currency: primaryCurrency,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const SummaryCard = ({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | null
  hint: string
  tone?: "positive" | "negative"
}) => {
  const Icon =
    tone === "positive"
      ? ArrowUpRight
      : tone === "negative"
        ? ArrowDownRight
        : null
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5 text-xs">
          {label}
          {Icon && (
            <Icon
              className={
                tone === "positive"
                  ? "size-3 text-emerald-600 dark:text-emerald-400"
                  : "size-3 text-destructive"
              }
            />
          )}
        </CardDescription>
        <CardTitle className="text-xl font-semibold tabular-nums">
          {value ?? <Skeleton className="h-7 w-32" />}
        </CardTitle>
      </CardHeader>
      <Separator />
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

const useBalancesByAccount = (
  txns: readonly { accountId: AccountId; amount: Money }[],
) =>
  useMemo(() => {
    const m = new Map<AccountId, bigint>()
    for (const t of txns) {
      m.set(t.accountId, (m.get(t.accountId) ?? 0n) + t.amount.minor)
    }
    return m
  }, [txns])

const useThisMonthCashflow = (
  txns: readonly { postedAt: number; amount: Money }[],
) =>
  useMemo(() => {
    const start = startOfMonth(Date.now())
    let income = 0n
    let expense = 0n
    let incomeCount = 0
    let expenseCount = 0
    for (const t of txns) {
      if (t.postedAt < start) continue
      if (t.amount.minor >= 0n) {
        income += t.amount.minor
        incomeCount++
      } else {
        expense += -t.amount.minor
        expenseCount++
      }
    }
    return { income, expense, incomeCount, expenseCount }
  }, [txns])

interface CategoryRow {
  readonly id: CategoryId | null
  readonly label: string
  readonly color: string | null
  readonly minor: bigint
  pct: number
}

const useTopCategoriesThisMonth = (
  txns: readonly { postedAt: number; amount: Money; categoryId: CategoryId | null }[],
  categoriesById: ReadonlyMap<CategoryId, { name: string; color: string | null }>,
): readonly CategoryRow[] =>
  useMemo(() => {
    const start = startOfMonth(Date.now())
    const buckets = new Map<CategoryId | null, bigint>()
    for (const t of txns) {
      if (t.postedAt < start) continue
      if (t.amount.minor >= 0n) continue
      const k = t.categoryId
      buckets.set(k, (buckets.get(k) ?? 0n) + t.amount.minor)
    }
    const rows: CategoryRow[] = [...buckets.entries()].map(([id, minor]) => {
      const cat = id ? categoriesById.get(id) : null
      return {
        id,
        label: cat?.name ?? "Uncategorized",
        color: cat?.color ?? null,
        minor,
        pct: 0,
      }
    })
    rows.sort((a, b) => Number(a.minor - b.minor))
    const top = rows.slice(0, 5)
    const max = top.reduce((m, r) => (r.minor < m ? r.minor : m), 0n)
    for (const r of top) {
      r.pct = max === 0n ? 0 : Math.round((Number(r.minor) / Number(max)) * 100)
    }
    return top
  }, [txns, categoriesById])

const startOfMonth = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
