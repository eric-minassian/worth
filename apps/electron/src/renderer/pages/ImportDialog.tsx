import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, FileUp, Link2 } from "lucide-react"
import { useEffect, useMemo, useState, type ChangeEvent } from "react"

import type { AccountId } from "@worth/domain"
import type { InputOf, OutputOf } from "@worth/ipc"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { invalidationKeys } from "../lib/queries"
import { formatDate } from "../lib/format"

type ColumnRole = "date" | "payee" | "amount" | "memo" | "skip"
type CsvPreview = OutputOf<"transaction.import.preview">
type CsvCommitResult = OutputOf<"transaction.import.commit">
type OfxPreview = OutputOf<"transaction.import.ofxPreview">
type OfxCommitResult = OutputOf<"transaction.import.ofxCommit">

type ImportFormat = "csv" | "ofx"

const roleOptions: readonly { value: ColumnRole; label: string }[] = [
  { value: "skip", label: "Skip" },
  { value: "date", label: "Date" },
  { value: "payee", label: "Payee" },
  { value: "amount", label: "Amount" },
  { value: "memo", label: "Memo" },
]

const detectFormat = (text: string): ImportFormat => {
  const head = text.slice(0, 200).trimStart()
  if (/^OFXHEADER\s*:/i.test(head)) return "ofx"
  if (head.startsWith("<?xml") || head.startsWith("<?OFX") || head.startsWith("<OFX>")) {
    return "ofx"
  }
  return "csv"
}

interface ImportDialogProps {
  readonly accounts: readonly { id: AccountId; name: string }[]
  readonly onClose: () => void
}

export const ImportDialog = ({ accounts, onClose }: ImportDialogProps) => {
  const [filename, setFilename] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const format = useMemo<ImportFormat | null>(
    () => (text === null ? null : detectFormat(text)),
    [text],
  )

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setFilename(file.name)
    setText(await file.text())
  }

  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Import transactions</DialogTitle>
        <DialogDescription>
          Upload a CSV, OFX, or QFX file from your bank. Re-running the same
          file is safe — duplicates are skipped.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-file">Transaction file</Label>
          <Input
            id="import-file"
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
            onChange={onFile}
          />
          {filename && (
            <p className="text-xs text-muted-foreground">
              {filename}
              {format ? ` — detected ${format.toUpperCase()}` : ""}
            </p>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {format === "csv" && text !== null && (
          <CsvImportFlow
            text={text}
            filename={filename}
            accounts={accounts}
            onClose={onClose}
            onError={setError}
          />
        )}
        {format === "ofx" && text !== null && (
          <OfxImportFlow
            text={text}
            filename={filename}
            accounts={accounts}
            onClose={onClose}
            onError={setError}
          />
        )}

        {format === null && (
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        )}
      </div>
    </DialogContent>
  )
}

interface FlowProps {
  readonly text: string
  readonly filename: string | null
  readonly accounts: readonly { id: AccountId; name: string }[]
  readonly onClose: () => void
  readonly onError: (msg: string | null) => void
}

const CsvImportFlow = ({ text, filename, accounts, onClose, onError }: FlowProps) => {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [mapping, setMapping] = useState<Record<number, ColumnRole>>({})
  const [accountId, setAccountId] = useState<AccountId | undefined>(accounts[0]?.id)
  const [result, setResult] = useState<CsvCommitResult | null>(null)

  const previewMutation = useMutation({
    mutationFn: (input: InputOf<"transaction.import.preview">) =>
      callCommand("transaction.import.preview", input),
    onSuccess: (data) => {
      setPreview(data)
      const initial: Record<number, ColumnRole> = {}
      for (const [k, v] of Object.entries(data.suggestedMapping)) {
        initial[Number(k)] = v
      }
      setMapping(initial)
    },
    onError: (e) => onError(formatRpcError(e)),
  })

  const commitMutation = useMutation({
    mutationFn: (input: InputOf<"transaction.import.commit">) =>
      callCommand("transaction.import.commit", input),
    onSuccess: async (data) => {
      setResult(data)
      await qc.invalidateQueries({ queryKey: invalidationKeys.transactions })
      toast.success(`Imported ${data.imported} transactions`)
    },
    onError: (e) => onError(formatRpcError(e)),
  })

  const previewMutate = previewMutation.mutate
  useEffect(() => {
    previewMutate({ text })
  }, [text, previewMutate])

  const onCommit = () => {
    onError(null)
    if (!accountId) return
    const mappingAsRecord: Record<string, ColumnRole> = {}
    for (const [k, v] of Object.entries(mapping)) mappingAsRecord[String(k)] = v
    commitMutation.mutate({ accountId, text, mapping: mappingAsRecord })
  }

  const requiredRoles: readonly ColumnRole[] = ["date", "payee", "amount"]
  const assigned = new Set(Object.values(mapping))
  const missing = requiredRoles.filter((r) => !assigned.has(r))
  const mappingComplete = preview !== null && missing.length === 0

  if (result) {
    return (
      <CsvResultView result={result} filename={filename} onDone={onClose} />
    )
  }

  return (
    <>
      {preview && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="import-account">Target account</Label>
            <Select
              value={accountId ?? ""}
              onValueChange={(v) => setAccountId(v as AccountId)}
            >
              <SelectTrigger id="import-account">
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

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Column mapping</Label>
              <div className="flex items-center gap-1">
                {requiredRoles.map((r) => (
                  <Badge key={r} variant="outline" className="gap-1 text-xs capitalize">
                    {assigned.has(r) ? (
                      <CheckCircle2 className="size-2.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <span className="size-2.5 rounded-full border border-dashed" />
                    )}
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview.headers.map((header, idx) => (
                      <TableHead key={idx} className="min-w-40">
                        <div className="flex flex-col gap-1.5 py-1">
                          <span className="text-xs font-semibold normal-case tracking-normal text-foreground">
                            {header || `Column ${idx + 1}`}
                          </span>
                          <Select
                            value={mapping[idx] ?? "skip"}
                            onValueChange={(v) =>
                              setMapping({ ...mapping, [idx]: v as ColumnRole })
                            }
                          >
                            <SelectTrigger className="h-7">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roleOptions.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sampleRows.map((row, rIdx) => (
                    <TableRow key={rIdx}>
                      {preview.headers.map((_, cIdx) => (
                        <TableCell key={cIdx} className="text-xs text-muted-foreground">
                          {row[cIdx] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          disabled={!mappingComplete || !accountId || commitMutation.isPending}
        >
          <FileUp />
          {commitMutation.isPending ? "Importing…" : "Import"}
        </Button>
      </DialogFooter>
    </>
  )
}

const CsvResultView = ({
  result,
  filename,
  onDone,
}: {
  readonly result: CsvCommitResult
  readonly filename: string | null
  readonly onDone: () => void
}) => (
  <div className="flex flex-col gap-4">
    <Alert>
      <CheckCircle2 />
      <AlertTitle>
        Imported {result.imported} new transaction{result.imported === 1 ? "" : "s"}
        {filename ? ` from ${filename}` : ""}
      </AlertTitle>
      <AlertDescription>
        {result.duplicates > 0 &&
          `${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped. `}
        {result.errors.length > 0 &&
          `${result.errors.length} row${result.errors.length === 1 ? "" : "s"} had errors.`}
        {result.duplicates === 0 && result.errors.length === 0 && "No duplicates or errors."}
      </AlertDescription>
    </Alert>

    {result.errors.length > 0 && (
      <div className="max-h-40 overflow-auto rounded-md border bg-card p-3 text-xs">
        <ul className="flex flex-col gap-1 text-muted-foreground">
          {result.errors.map((err, i) => (
            <li key={i}>
              {err.rowIndex >= 0 ? `Row ${err.rowIndex + 1}: ` : ""}
              {err.message}
            </li>
          ))}
        </ul>
      </div>
    )}

    <DialogFooter>
      <Button type="button" onClick={onDone}>
        Done
      </Button>
    </DialogFooter>
  </div>
)

interface StatementChoice {
  readonly accountId: AccountId | null
  readonly linkAccount: boolean
}

const OfxImportFlow = ({ text, filename, accounts, onClose, onError }: FlowProps) => {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<OfxPreview | null>(null)
  const [choices, setChoices] = useState<Record<string, StatementChoice>>({})
  const [result, setResult] = useState<OfxCommitResult | null>(null)

  const previewMutation = useMutation({
    mutationFn: (input: InputOf<"transaction.import.ofxPreview">) =>
      callCommand("transaction.import.ofxPreview", input),
    onSuccess: (data) => {
      setPreview(data)
      const initial: Record<string, StatementChoice> = {}
      for (const s of data.statements) {
        initial[s.externalKey] = {
          accountId: s.matchedAccountId ?? accounts[0]?.id ?? null,
          linkAccount: s.matchedAccountId === null,
        }
      }
      setChoices(initial)
    },
    onError: (e) => onError(formatRpcError(e)),
  })

  const commitMutation = useMutation({
    mutationFn: (input: InputOf<"transaction.import.ofxCommit">) =>
      callCommand("transaction.import.ofxCommit", input),
    onSuccess: async (data) => {
      setResult(data)
      await qc.invalidateQueries({ queryKey: invalidationKeys.transactions })
      const total = data.perStatement.reduce((n, s) => n + s.imported, 0)
      toast.success(`Imported ${total} transactions`)
    },
    onError: (e) => onError(formatRpcError(e)),
  })

  const previewMutate = previewMutation.mutate
  useEffect(() => {
    previewMutate({ text })
  }, [text, previewMutate])

  if (result) {
    return <OfxResultView result={result} filename={filename} onDone={onClose} />
  }

  if (!preview) {
    return (
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    )
  }

  const hasBanking = preview.statements.length > 0
  const investmentOnly = !hasBanking && preview.investmentStatementCount > 0
  const ready =
    hasBanking &&
    preview.statements.every((s) => choices[s.externalKey]?.accountId !== null)

  const onCommit = () => {
    onError(null)
    const assignments = preview.statements
      .map((s) => {
        const choice = choices[s.externalKey]
        if (!choice || !choice.accountId) return null
        return {
          externalKey: s.externalKey,
          accountId: choice.accountId,
          linkAccount: choice.linkAccount,
        }
      })
      .filter((a): a is NonNullable<typeof a> => a !== null)
    commitMutation.mutate({ text, assignments })
  }

  return (
    <>
      {investmentOnly && (
        <Alert>
          <AlertTitle>Investment transactions detected</AlertTitle>
          <AlertDescription>
            This file contains {preview.investmentStatementCount} investment
            statement{preview.investmentStatementCount === 1 ? "" : "s"}.
            Worth will support investment imports in an upcoming release.
          </AlertDescription>
        </Alert>
      )}

      {preview.statements.map((s) => {
        const choice = choices[s.externalKey] ?? { accountId: null, linkAccount: true }
        const isLinked = s.matchedAccountId !== null
        return (
          <div
            key={s.externalKey}
            className="flex flex-col gap-3 rounded-md border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {s.institutionId ?? "Credit card"} — account {s.accountIdHint}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.transactionCount} transaction{s.transactionCount === 1 ? "" : "s"}
                  {s.earliest && s.latest && s.transactionCount > 0
                    ? ` · ${formatDate(s.earliest)} – ${formatDate(s.latest)}`
                    : ""}
                  {s.accountType ? ` · ${s.accountType}` : ""}
                </p>
              </div>
              {isLinked && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Link2 className="size-3" />
                  Linked
                </Badge>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Target Worth account</Label>
              <Select
                value={choice.accountId ?? ""}
                onValueChange={(v) =>
                  setChoices({
                    ...choices,
                    [s.externalKey]: { ...choice, accountId: v as AccountId },
                  })
                }
                disabled={isLinked}
              >
                <SelectTrigger>
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
              {!isLinked && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 rounded border-input accent-primary"
                    checked={choice.linkAccount}
                    onChange={(e) =>
                      setChoices({
                        ...choices,
                        [s.externalKey]: { ...choice, linkAccount: e.target.checked },
                      })
                    }
                  />
                  Remember this mapping for future imports
                </label>
              )}
            </div>

            {s.sample.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Payee</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.sample.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(r.postedAt)}
                        </TableCell>
                        <TableCell className="text-xs">{r.payee}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatOfxAmount(r.amountMinor, s.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )
      })}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          disabled={!ready || commitMutation.isPending}
        >
          <FileUp />
          {commitMutation.isPending ? "Importing…" : "Import"}
        </Button>
      </DialogFooter>
    </>
  )
}

const formatOfxAmount = (minorStr: string, currency: string | null): string => {
  const minor = BigInt(minorStr)
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  const whole = abs / 100n
  const frac = (abs % 100n).toString().padStart(2, "0")
  const sign = negative ? "-" : ""
  if (currency) return `${sign}${whole}.${frac} ${currency}`
  return `${sign}${whole}.${frac}`
}

const OfxResultView = ({
  result,
  filename,
  onDone,
}: {
  readonly result: OfxCommitResult
  readonly filename: string | null
  readonly onDone: () => void
}) => {
  const total = result.perStatement.reduce((n, s) => n + s.imported, 0)
  const duplicates = result.perStatement.reduce((n, s) => n + s.duplicates, 0)
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <CheckCircle2 />
        <AlertTitle>
          Imported {total} new transaction{total === 1 ? "" : "s"}
          {filename ? ` from ${filename}` : ""}
        </AlertTitle>
        <AlertDescription>
          {duplicates > 0 &&
            `${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped. `}
          {result.investmentStatementCount > 0 &&
            `${result.investmentStatementCount} investment statement${
              result.investmentStatementCount === 1 ? "" : "s"
            } skipped (coming later).`}
          {duplicates === 0 && result.investmentStatementCount === 0 &&
            "No duplicates."}
        </AlertDescription>
      </Alert>

      {result.warnings.length > 0 && (
        <div className="max-h-40 overflow-auto rounded-md border bg-card p-3 text-xs">
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  )
}
