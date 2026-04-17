import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "./cn"

type Variant = "default" | "secondary" | "ghost" | "destructive"
type Size = "default" | "sm" | "icon"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant
  readonly size?: Size
  readonly children: ReactNode
}

const variantClasses: Record<Variant, string> = {
  default:
    "bg-neutral-100 text-neutral-900 hover:bg-white dark:bg-neutral-100 dark:text-neutral-900",
  secondary:
    "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
  ghost:
    "bg-transparent text-neutral-100 hover:bg-neutral-800",
  destructive:
    "bg-red-600 text-white hover:bg-red-500",
}

const sizeClasses: Record<Size, string> = {
  default: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-xs",
  icon: "h-9 w-9",
}

export const Button = ({
  variant = "default",
  size = "default",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={cn(
      "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
      "disabled:opacity-50 disabled:pointer-events-none",
      variantClasses[variant],
      sizeClasses[size],
      className,
    )}
    {...rest}
  >
    {children}
  </button>
)
