import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState, type FormEvent } from "react"
import type { CategoryId } from "@worth/domain"
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
import { categoriesQuery, invalidationKeys } from "../lib/queries"

export const CategoriesPage = () => {
  const categories = useQuery(categoriesQuery)
  const [open, setOpen] = useState(false)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Categories</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Tags you attach to transactions to track where your money goes.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> Add category
            </Button>
          </DialogTrigger>
          <CategoryDialog
            existing={categories.data ?? []}
            onClose={() => setOpen(false)}
          />
        </Dialog>
      </header>

      <div className="rounded-lg border border-neutral-800 bg-neutral-950">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Color</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.data && categories.data.length > 0 ? (
              categories.data.map((c) => {
                const parent = categories.data?.find((p) => p.id === c.parentId)
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-neutral-400">{parent?.name ?? "—"}</TableCell>
                    <TableCell>
                      {c.color ? (
                        <span className="inline-flex items-center gap-2 text-neutral-400">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
                          {c.color}
                        </span>
                      ) : (
                        <span className="text-neutral-500">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-sm text-neutral-500">
                  No categories yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

interface CategoryDialogProps {
  readonly existing: readonly { id: CategoryId; name: string }[]
  readonly onClose: () => void
}

const CategoryDialog = ({ existing, onClose }: CategoryDialogProps) => {
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [parentId, setParentId] = useState<CategoryId | "">("")
  const [color, setColor] = useState("")
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      callCommand("category.create", {
        name: name.trim(),
        parentId: parentId === "" ? null : parentId,
        color: color.trim() === "" ? null : color.trim(),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.categories })
      setName("")
      setParentId("")
      setColor("")
      onClose()
    },
    onError: (e) => setError(e instanceof RpcError ? `${e.tag}: ${e.message}` : String(e)),
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
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>
            Optionally nest under a parent category for hierarchies like Food → Groceries.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cat-name">Name</Label>
          <Input
            id="cat-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Groceries"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cat-parent">Parent</Label>
          <Select
            id="cat-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value as CategoryId | "")}
          >
            <option value="">None</option>
            {existing.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cat-color">Color (hex)</Label>
          <Input
            id="cat-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#22c55e"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

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
