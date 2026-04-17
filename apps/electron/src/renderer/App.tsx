import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { router } from "./routes"
import { Unlock } from "./pages/Unlock"
import { callCommand } from "./rpc"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

type VaultState =
  | { status: "checking" }
  | { status: "locked"; initialized: boolean }
  | { status: "unlocked" }

export const App = () => {
  const [vault, setVault] = useState<VaultState>({ status: "checking" })

  useEffect(() => {
    let cancelled = false
    void callCommand("vault.status", {}).then((result) => {
      if (cancelled) return
      setVault(
        result.unlocked
          ? { status: "unlocked" }
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
        onUnlocked={() => setVault({ status: "unlocked" })}
      />
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
