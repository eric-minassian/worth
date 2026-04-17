import * as LabelPrimitive from "@radix-ui/react-label"
import type { ComponentProps } from "react"
import { cn } from "./cn"

export const Label = ({ className, ...rest }: ComponentProps<typeof LabelPrimitive.Root>) => (
  <LabelPrimitive.Root
    className={cn(
      "text-sm font-medium text-neutral-300 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...rest}
  />
)
