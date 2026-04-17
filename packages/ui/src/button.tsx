import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "./cn"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "default" | "secondary" | "ghost"
  readonly children: ReactNode
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default:
    "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
  secondary:
    "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
  ghost:
    "bg-transparent text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800",
}

export const Button = ({ variant = "default", className, children, ...rest }: ButtonProps) => (
  <button
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-50",
      variantClasses[variant],
      className,
    )}
    {...rest}
  >
    {children}
  </button>
)
