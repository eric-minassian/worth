import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

interface EmptyStateProps {
  readonly Icon: LucideIcon
  readonly title: string
  readonly hint?: string
  readonly action?: ReactNode
}

export const EmptyState = ({ Icon, title, hint, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
    <Icon className="size-6 text-muted-foreground" />
    <p className="text-sm font-medium">{title}</p>
    {hint && (
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    )}
    {action}
  </div>
)
