import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { router } from "./routes"
import { Unlock } from "./pages/Unlock"
import { BiometricEnrollPrompt } from "./components/BiometricEnrollPrompt"
import { callCommand } from "./rpc"
import { queryClient } from "./lib/queryClient"

type VaultState =
  | { status: "checking" }
  | { status: "locked"; initialized: boolean }
  | { status: "unlocked"; via: "password" | "biometric" | null }

export const App = () => {
  const [vault, setVault] = useState<VaultState>({ status: "checking" })

  useEffect(() => {
    let cancelled = false
    void callCommand("vault.status", {}).then((result) => {
      if (cancelled) return
      setVault(
        result.unlocked
          ? { status: "unlocked", via: null }
          : { status: "locked", initialized: result.initialized },
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (vault.status === "checking") {
    return <div className="flex h-full items-center justify-center text-muted-foreground" />
  }

  if (vault.status === "locked") {
    return (
      <Unlock
        initialized={vault.initialized}
        onUnlocked={(via) => setVault({ status: "unlocked", via })}
      />
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {vault.via === "password" ? <BiometricEnrollPrompt /> : null}
    </QueryClientProvider>
  )
}
