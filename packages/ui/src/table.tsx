import type { ComponentProps } from "react"
import { cn } from "./cn"

export const Table = ({ className, ...rest }: ComponentProps<"table">) => (
  <div className="relative w-full overflow-auto">
    <table className={cn("w-full caption-bottom text-sm", className)} {...rest} />
  </div>
)

export const TableHeader = ({ className, ...rest }: ComponentProps<"thead">) => (
  <thead className={cn("border-b border-neutral-800 [&_tr]:border-b-0", className)} {...rest} />
)

export const TableBody = ({ className, ...rest }: ComponentProps<"tbody">) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} {...rest} />
)

export const TableRow = ({ className, ...rest }: ComponentProps<"tr">) => (
  <tr
    className={cn(
      "border-b border-neutral-800/60 transition-colors hover:bg-neutral-900/40",
      className,
    )}
    {...rest}
  />
)

export const TableHead = ({ className, ...rest }: ComponentProps<"th">) => (
  <th
    className={cn(
      "h-10 px-4 text-left align-middle text-xs font-medium uppercase tracking-wide text-neutral-400",
      className,
    )}
    {...rest}
  />
)

export const TableCell = ({ className, ...rest }: ComponentProps<"td">) => (
  <td className={cn("px-4 py-3 align-middle", className)} {...rest} />
)
