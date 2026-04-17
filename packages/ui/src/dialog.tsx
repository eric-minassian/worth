import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "./cn"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

export const DialogOverlay = ({
  className,
  ...rest
}: ComponentProps<typeof DialogPrimitive.Overlay>) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...rest}
  />
)

interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  readonly children: ReactNode
}

export const DialogContent = ({ className, children, ...rest }: DialogContentProps) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
        "rounded-lg border border-neutral-800 bg-neutral-950 p-6 shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        className,
      )}
      {...rest}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-md p-1 text-neutral-400 opacity-70 transition-opacity hover:opacity-100 focus:outline-none"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
)

export const DialogHeader = ({ className, ...rest }: ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...rest} />
)

export const DialogFooter = ({ className, ...rest }: ComponentProps<"div">) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    {...rest}
  />
)

export const DialogTitle = ({
  className,
  ...rest
}: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("text-lg font-semibold text-neutral-100", className)}
    {...rest}
  />
)

export const DialogDescription = ({
  className,
  ...rest
}: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("text-sm text-neutral-400", className)}
    {...rest}
  />
)
