import type { ComponentProps } from "react"
import { cn } from "./cn"

export const Card = ({ className, ...rest }: ComponentProps<"div">) => (
  <div
    className={cn(
      "rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-100 shadow-sm",
      className,
    )}
    {...rest}
  />
)

export const CardHeader = ({ className, ...rest }: ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-1.5 p-6", className)} {...rest} />
)

export const CardTitle = ({ className, ...rest }: ComponentProps<"h3">) => (
  <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...rest} />
)

export const CardDescription = ({ className, ...rest }: ComponentProps<"p">) => (
  <p className={cn("text-sm text-neutral-400", className)} {...rest} />
)

export const CardContent = ({ className, ...rest }: ComponentProps<"div">) => (
  <div className={cn("p-6 pt-0", className)} {...rest} />
)

export const CardFooter = ({ className, ...rest }: ComponentProps<"div">) => (
  <div className={cn("flex items-center p-6 pt-0", className)} {...rest} />
)
