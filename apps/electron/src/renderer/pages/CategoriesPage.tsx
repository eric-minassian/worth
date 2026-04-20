import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Tag } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"

import type { CategoryId } from "@worth/domain"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
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
  Skeleton,
  toast,
} from "@worth/ui"
import { callCommand, formatRpcError } from "../rpc"
import { categoriesQuery, invalidationKeys } from "../lib/queries"
import { PageActions } from "../Layout"
import { EmptyState } from "../components/EmptyState"

const NO_PARENT = "__none__"

const COLOR_PRESETS = [
  "#22c55e",
  "#10b981",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#06b6d4",
  "#64748b",
] as const

interface CategoryNode {
  readonly id: CategoryId
  readonly name: string
  readonly color: string | null
  readonly children: CategoryNode[]
}

export const CategoriesPage = () => {
  const categories = useQuery(categoriesQuery)
  const [open, setOpen] = useState(false)

  const tree = useMemo<readonly CategoryNode[]>(() => {
    const list = categories.data ?? []
    const byId = new Map<CategoryId, CategoryNode>()
    for (const c of list) {
      byId.set(c.id, { id: c.id, name: c.name, color: c.color, children: [] })
    }
    const roots: CategoryNode[] = []
    for (const c of list) {
      const node = byId.get(c.id)
      if (!node) continue
      const parent = c.parentId ? byId.get(c.parentId) : null
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    return roots
  }, [categories.data])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-6">
      <PageActions>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> Add category
            </Button>
          </DialogTrigger>
          <CategoryDialog
            existing={categories.data ?? []}
            onClose={() => setOpen(false)}
          />
        </Dialog>
      </PageActions>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">All categories</CardTitle>
          <CardDescription className="text-xs">
            Nest categories with a parent for hierarchies like Food → Groceries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {categories.isPending ? (
            <ul className="flex flex-col gap-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <Skeleton className="size-2.5 rounded-full" />
                  <Skeleton className="h-3 w-40" />
                </li>
              ))}
            </ul>
          ) : tree.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {tree.map((node) => (
                <CategoryRow key={node.id} node={node} depth={0} />
              ))}
            </ul>
          ) : (
            <EmptyState
              Icon={Tag}
              title="No categories yet"
              hint="Add categories like Groceries, Rent, or Salary to track flow."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const CategoryRow = ({
  node,
  depth,
}: {
  node: CategoryNode
  depth: number
}) => (
  <li>
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: node.color ?? "var(--muted-foreground)" }}
      />
      <span className="text-xs font-medium">{node.name}</span>
      {node.children.length > 0 && (
        <span className="ml-auto text-xs text-muted-foreground">
          {node.children.length} child
          {node.children.length === 1 ? "" : "ren"}
        </span>
      )}
    </div>
    {node.children.length > 0 && (
      <ul className="flex flex-col gap-1">
        {node.children.map((child) => (
          <CategoryRow key={child.id} node={child} depth={depth + 1} />
        ))}
      </ul>
    )}
  </li>
)

interface CategoryDialogProps {
  readonly existing: readonly { id: CategoryId; name: string }[]
  readonly onClose: () => void
}

const CategoryDialog = ({ existing, onClose }: CategoryDialogProps) => {
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [parentId, setParentId] = useState<string>(NO_PARENT)
  const [color, setColor] = useState<string>(COLOR_PRESETS[0])
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      callCommand("category.create", {
        name: name.trim(),
        parentId: parentId === NO_PARENT ? null : (parentId as CategoryId),
        color: color.trim() === "" ? null : color.trim(),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invalidationKeys.categories })
      toast.success(`Created ${name.trim()}`)
      setName("")
      setParentId(NO_PARENT)
      setColor(COLOR_PRESETS[0])
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
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>
            Optionally nest under a parent for hierarchies like Food → Groceries.
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
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger id="cat-parent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PARENT}>None (top level)</SelectItem>
              {existing.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={cn(
                  "size-6 rounded-full ring-offset-2 ring-offset-background transition",
                  color === c && "ring-2 ring-ring",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create category"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
