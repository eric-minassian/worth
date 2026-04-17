import type { InputHTMLAttributes } from "react"
import { cn } from "./cn"

export const Input = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      "flex h-9 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1 text-sm text-neutral-100 shadow-xs",
      "placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      className,
    )}
    {...rest}
  />
)
