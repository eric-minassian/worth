import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@worth/ui"
import { accountsQuery, transactionsQuery } from "../lib/queries"
import { formatMoney } from "../lib/format"

export const Dashboard = () => {
  const accounts = useQuery(accountsQuery)
  const recent = useQuery(
    transactionsQuery({
      accountId: undefined,
      search: undefined,
      limit: 10,
      order: "posted-desc",
    }),
  )

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-1 text-sm text-neutral-400">Your money at a glance.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Accounts</CardDescription>
            <CardTitle>{accounts.data?.length ?? "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Recent transactions</CardDescription>
            <CardTitle>{recent.data?.length ?? "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Status</CardDescription>
            <CardTitle className="text-base font-medium text-emerald-400">Local only</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.data && recent.data.length > 0 ? (
            <ul className="divide-y divide-neutral-800">
              {recent.data.map((txn) => (
                <li key={txn.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{txn.payee}</span>
                  <span
                    className={
                      txn.amount.minor < 0n ? "text-red-400" : "text-emerald-400"
                    }
                  >
                    {formatMoney(txn.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">No transactions yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
