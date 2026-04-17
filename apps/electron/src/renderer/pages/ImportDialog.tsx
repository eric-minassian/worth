import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, FileUp } from "lucide-react"
import { useState, type ChangeEvent } from "react"

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

type ColumnRole = "date" | "payee" | "amount" | "memo" | "skip"
type Preview = OutputOf<"transaction.import.preview">
type CommitResult = OutputOf<"transaction.import.commit">

const roleOptions: readonly { value: ColumnRole; label: string }[] = [
  { value: "skip", label: "Skip" },
  { value: "date", label: "Date" },
  { value: "payee", label: "Payee" },
  { value: "amount", label: "Amount" },
  { value: "memo", label: "Memo" },
]

interface ImportDialogProps {
  readonly accounts: readonly { id: AccountId; name: string }[]
  readonly onClose: () => void
}

export const ImportDialog = ({ accounts, onClose }: ImportDialogProps) => {
  const qc = useQueryClient()
  const [filename, setFilename] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Record<number, ColumnRole>>({})
  const [accountId, setAccountId] = useState<AccountId | undefined>(accounts[0]?.id)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CommitResult | null>(null)

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
    onError: (e) => setError(formatRpcError(e)),
  })

  const commitMutation = useMutation({
    mutationFn: (input: InputOf<"transaction.import.commit">) =>
      callCommand("transaction.import.commit", input),
    onSuccess: async (data) => {
      setResult(data)
      await qc.invalidateQueries({ queryKey: invalidationKeys.transactions })
      toast.success(`Imported ${data.imported} transactions`)
    },
    onError: (e) => setError(formatRpcError(e)),
  })

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    setFilename(file.name)
    const csvText = await file.text()
    setText(csvText)
    previewMutation.mutate({ text: csvText })
  }

  const onCommit = () => {
    setError(null)
    if (!accountId || !text) return
    const mappingAsRecord: Record<string, ColumnRole> = {}
    for (const [k, v] of Object.entries(mapping)) mappingAsRecord[String(k)] = v
    commitMutation.mutate({ accountId, text, mapping: mappingAsRecord })
  }

  const requiredRoles: readonly ColumnRole[] = ["date", "payee", "amount"]
  const assigned = new Set(Object.values(mapping))
  const missing = requiredRoles.filter((r) => !assigned.has(r))
  const mappingComplete = preview !== null && missing.length === 0

  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Import transactions</DialogTitle>
        <DialogDescription>
          Upload a CSV from your bank. Confirm the column mapping, pick the
          target account, and import. Re-running the same file is safe —
          duplicates are skipped.
        </DialogDescription>
      </DialogHeader>

      {result ? (
        <ImportResultView
          result={result}
          filename={filename}
          onDone={onClose}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="csv-file">CSV file</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
            />
            {filename && (
              <p className="text-xs text-muted-foreground">
                {filename} — {preview?.totalRows ?? 0} rows
              </p>
            )}
          </div>

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
                      <Badge
                        key={r}
                        variant="outline"
                        className="gap-1 text-xs capitalize"
                      >
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
                                  setMapping({
                                    ...mapping,
                                    [idx]: v as ColumnRole,
                                  })
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
                            <TableCell
                              key={cIdx}
                              className="text-xs text-muted-foreground"
                            >
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

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onCommit}
              disabled={
                !mappingComplete || !accountId || commitMutation.isPending
              }
            >
              <FileUp />
              {commitMutation.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  )
}

interface ImportResultViewProps {
  readonly result: CommitResult
  readonly filename: string | null
  readonly onDone: () => void
}

const ImportResultView = ({ result, filename, onDone }: ImportResultViewProps) => (
  <div className="flex flex-col gap-4">
    <Alert>
      <CheckCircle2 />
      <AlertTitle>
        Imported {result.imported} new transaction
        {result.imported === 1 ? "" : "s"}
        {filename ? ` from ${filename}` : ""}
      </AlertTitle>
      <AlertDescription>
        {result.duplicates > 0 &&
          `${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped. `}
        {result.errors.length > 0 &&
          `${result.errors.length} row${result.errors.length === 1 ? "" : "s"} had errors.`}
        {result.duplicates === 0 &&
          result.errors.length === 0 &&
          "No duplicates or errors."}
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
