import { useState, type FormEvent } from "react"
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@worth/ui"
import { callCommand } from "../rpc"

interface UnlockProps {
  readonly initialized: boolean
  readonly onUnlocked: () => void
}

export const Unlock = ({ initialized, onUnlocked }: UnlockProps) => {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        onUnlocked()
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

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{initialized ? "Unlock Worth" : "Create a password"}</CardTitle>
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
                disabled={submitting}
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
                  disabled={submitting}
                />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Unlocking…" : initialized ? "Unlock" : "Create vault"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
