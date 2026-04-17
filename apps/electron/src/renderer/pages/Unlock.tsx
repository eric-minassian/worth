import { useEffect, useState, type FormEvent } from "react"
import { Fingerprint } from "lucide-react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@worth/ui"
import { callCommand } from "../rpc"
import { WorthMark } from "../components/WorthMark"

interface UnlockProps {
  readonly initialized: boolean
  readonly onUnlocked: (via: "password" | "biometric") => void
}

export const Unlock = ({ initialized, onUnlocked }: UnlockProps) => {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [biometricPending, setBiometricPending] = useState(false)

  const tryBiometric = async () => {
    setError(null)
    setBiometricPending(true)
    try {
      const result = await callCommand("vault.unlockBiometric", {})
      if (result.ok) {
        onUnlocked("biometric")
        return
      }
      if (result.reason === "user-cancelled") return
      if (result.reason === "not-enabled" || result.reason === "unavailable") {
        setBiometricEnabled(false)
        return
      }
      if (result.reason === "wrong-password") {
        setBiometricEnabled(false)
        setError("Stored Touch ID credential is out of date. Enter your password.")
        return
      }
      setError("Database file appears corrupt.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBiometricPending(false)
    }
  }

  useEffect(() => {
    if (!initialized) return
    let cancelled = false
    void callCommand("vault.biometricStatus", {}).then((status) => {
      if (cancelled) return
      setBiometricAvailable(status.available)
      setBiometricEnabled(status.enabled)
      if (status.available && status.enabled) {
        void tryBiometric()
      }
    })
    return () => {
      cancelled = true
    }
  }, [initialized])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (password.length === 0) {
      setError("Password is required.")
      return
    }
    if (!initialized && password !== confirm) {
      setError("Passwords do not match.")
      return
    }

    setSubmitting(true)
    try {
      const result = await callCommand("vault.unlock", { password })
      if (result.ok) {
        onUnlocked("password")
        return
      }
      setError(
        result.reason === "wrong-password"
          ? "Incorrect password."
          : "Database file appears corrupt.",
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const showBiometricButton =
    initialized && biometricAvailable && biometricEnabled

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <WorthMark className="mb-2 size-10 rounded-lg" />
          <CardTitle>{initialized ? "Unlock Worth" : "Welcome to Worth"}</CardTitle>
          <CardDescription>
            {initialized
              ? "Enter your password to unlock your encrypted data."
              : "Your data is encrypted at rest. Choose a password — there is no recovery if lost."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting || biometricPending}
              />
            </div>
            {!initialized ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  disabled={submitting || biometricPending}
                />
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Unable to unlock</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={submitting || biometricPending}>
              {submitting
                ? "Unlocking…"
                : initialized
                  ? "Unlock"
                  : "Create vault"}
            </Button>
            {showBiometricButton ? (
              <Button
                type="button"
                variant="secondary"
                disabled={submitting || biometricPending}
                onClick={() => void tryBiometric()}
              >
                <Fingerprint />
                {biometricPending ? "Waiting for Touch ID…" : "Unlock with Touch ID"}
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
