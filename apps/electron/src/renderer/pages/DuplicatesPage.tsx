import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import { ShieldCheck, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type { AccountId, Transaction, TransactionId } from "@worth/domain"
import { importSourceOf } from "@worth/importers/source"
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
  Checkbox,
  cn,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@worth/ui"
import { callCommand, formatRpcError } from "../rpc"
import { accountsQuery, invalidationKeys } from "../lib/queries"
import { formatDate, formatMoney } from "../lib/format"

const SOURCE_LABEL: Record<ReturnType<typeof importSourceOf>, string> = {
  manual: "Manual",
  csv: "CSV",
  ofx: "OFX",
  unknown: "Imported",
}

const ALL_ACCOUNTS = "__all_accounts__"

const WINDOW_OPTIONS = [
  { value: "0", label: "Exact match" },
  { value: "1", label: "Within 1 day" },
  { value: "3", label: "Within 3 days" },
  { value: "7", label: "Within 7 days" },
] as const

const duplicateGroupsQuery = (
  accountId: AccountId | undefined,
  windowDays: number,
) =>
  queryOptions({
    queryKey: ["transaction.listDuplicates", { accountId, windowDays }] as const,
    queryFn: () =>
      callCommand("transaction.listDuplicates", { accountId, windowDays }),
    staleTime: 0,
  })

const groupKey = (g: {
  readonly members: readonly { readonly id: TransactionId }[]
}): string =>
  [...g.members]
    .map((m) => m.id)
    .sort()
    .join(",")

export const DuplicatesPage = () => {
  const [accountFilter, setAccountFilter] = useState<string>(ALL_ACCOUNTS)
  const [windowValue, setWindowValue] = useState<string>("0")
  const accounts = useQuery(accountsQuery)
  const accountId =
    accountFilter === ALL_ACCOUNTS ? undefined : (accountFilter as AccountId)
  const windowDays = Number.parseInt(windowValue, 10)
  const groupsQuery = useQuery(duplicateGroupsQuery(accountId, windowDays))
  const qc = useQueryClient()

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  )

  // Set of transaction ids marked for deletion. Default: every member of every
  // group except the oldest (first in service-sorted list). We track which
  // ids we've ever seen so post-refetch we preserve the user's toggles instead
  // of re-applying defaults to rows they already decided on.
  const [checked, setChecked] = useState<Set<TransactionId>>(() => new Set())
  const everSeenRef = useRef<Set<TransactionId>>(new Set())
  useEffect(() => {
    if (!groupsQuery.data) return
    const everSeen = everSeenRef.current
    setChecked((prev) => {
      const next = new Set<TransactionId>()
      for (const g of groupsQuery.data) {
        for (let i = 0; i < g.members.length; i++) {
          const m = g.members[i]
          if (!m) continue
          if (everSeen.has(m.id)) {
            if (prev.has(m.id)) next.add(m.id)
          } else {
            everSeen.add(m.id)
            if (i > 0) next.add(m.id)
          }
        }
      }
      return next
    })
  }, [groupsQuery.data])

  const toggle = (id: TransactionId) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const groups = groupsQuery.data ?? []
  const selectedIds = useMemo(() => {
    const ids: TransactionId[] = []
    for (const g of groups) {
      for (const m of g.members) if (checked.has(m.id)) ids.push(m.id)
    }
    return ids
  }, [groups, checked])

  const [confirmOpen, setConfirmOpen] = useState(false)
  const resolve = useMutation({
    mutationFn: () => callCommand("transaction.deleteMany", { ids: selectedIds }),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["transaction.listDuplicates"] })
      await qc.invalidateQueries({ queryKey: invalidationKeys.transactions })
      toast.success(`Deleted ${result.deleted}`)
      setConfirmOpen(false)
    },
    onError: (e) => {
      toast.error(formatRpcError(e))
      setConfirmOpen(false)
    },
  })

  const dismiss = useMutation({
    mutationFn: (memberIds: readonly TransactionId[]) =>
      callCommand("transaction.dismissDuplicateGroup", { memberIds }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["transaction.listDuplicates"] })
      toast.success("Marked as not duplicates")
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="h-8 w-[200px]">
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
        <Select value={windowValue} onValueChange={setWindowValue}>
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="ml-auto"
          variant="destructive"
          size="sm"
          disabled={selectedIds.length === 0 || resolve.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {selectedIds.length === 0
            ? "Nothing selected"
            : `Delete ${selectedIds.length}`}
        </Button>
      </div>

      {groupsQuery.data && groups.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <ShieldCheck className="size-6" />
          <p className="text-sm">No duplicates.</p>
        </div>
      )}

      {groups.length > 0 && (
        <ul className="flex flex-col">
          {groups.map((g, gi) => {
            const ids = g.members.map((m) => m.id)
            return (
              <li
                key={groupKey(g)}
                className={cn("flex flex-col gap-1 py-3", gi > 0 && "border-t")}
              >
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatDate(g.postedAt)}</span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      g.amount.minor < 0n
                        ? "text-destructive"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {formatMoney(g.amount)}
                  </span>
                  {accountFilter === ALL_ACCOUNTS && (
                    <span>{accountById.get(g.accountId)?.name}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label="Not duplicates"
                    title="Not duplicates — hide this group"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(ids)}
                  >
                    <X />
                  </Button>
                </div>
                {g.members.map((m) => (
                  <Row
                    key={m.id}
                    member={m}
                    checked={checked.has(m.id)}
                    onToggle={() => toggle(m.id)}
                  />
                ))}
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length}{" "}
              {selectedIds.length === 1 ? "transaction" : "transactions"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Unchecked rows stay. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => resolve.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const Row = ({
  member,
  checked,
  onToggle,
}: {
  readonly member: Transaction
  readonly checked: boolean
  readonly onToggle: () => void
}) => {
  const id = `dup-${member.id}`
  return (
    <div className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-accent/50">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <Label
        htmlFor={id}
        className={cn(
          "flex min-w-0 flex-1 items-baseline gap-2 font-normal",
          checked && "text-muted-foreground line-through",
        )}
      >
        <span className="truncate text-sm" title={member.payee}>
          {member.payee}
        </span>
        {member.memo && (
          <span
            className="truncate text-xs text-muted-foreground"
            title={member.memo}
          >
            {member.memo}
          </span>
        )}
      </Label>
      <Badge variant="outline" className="font-normal">
        {SOURCE_LABEL[importSourceOf(member.importHash)]}
      </Badge>
    </div>
  )
}

