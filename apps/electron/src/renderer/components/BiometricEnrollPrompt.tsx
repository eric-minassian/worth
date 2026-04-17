import { useEffect, useState } from "react"
import { Fingerprint } from "lucide-react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@worth/ui"
import { callCommand, formatRpcError } from "../rpc"

const DISMISSED_KEY = "worth:touchid-prompt-dismissed"

/**
 * One-shot nudge to enroll Touch ID. Rendered after a successful password
 * unlock; skipped when unlock came from biometric (user already knows), when
 * Touch ID is unavailable or already enabled, and once the user has dismissed
 * it in a prior session.
 */
export const BiometricEnrollPrompt = () => {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) === "1") return
    let cancelled = false
    void callCommand("vault.biometricStatus", {}).then((status) => {
      if (cancelled) return
      if (status.available && !status.enabled) setOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onEnable = async () => {
    setSubmitting(true)
    try {
      const result = await callCommand("vault.enableBiometric", {})
      if (result.ok) {
        localStorage.setItem(DISMISSED_KEY, "1")
        toast.success("Touch ID enabled")
        setOpen(false)
        return
      }
      toast.error(
        result.reason === "unavailable"
          ? "Touch ID is not available on this device."
          : "Unlock the vault first.",
      )
    } catch (cause) {
      toast.error(formatRpcError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const onDismiss = (remember: boolean) => {
    if (remember) localStorage.setItem(DISMISSED_KEY, "1")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss(false)}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Fingerprint className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <DialogTitle>Unlock faster with Touch ID</DialogTitle>
              <DialogDescription>
                Skip typing your password each time. Your password stays
                encrypted in the system keychain and is only released after a
                Touch ID prompt.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onDismiss(true)}
            disabled={submitting}
          >
            Don't ask again
          </Button>
          <Button
            variant="secondary"
            onClick={() => onDismiss(false)}
            disabled={submitting}
          >
            Not now
          </Button>
          <Button onClick={() => void onEnable()} disabled={submitting}>
            <Fingerprint />
            {submitting ? "Enabling…" : "Enable Touch ID"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
