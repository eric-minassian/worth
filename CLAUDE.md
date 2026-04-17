# Worth

Personal-finance app. Electron desktop (M0–M3 shipped) → future self-hosted server + mobile.

Stack: pnpm workspaces · TypeScript 6 strict · Effect v4 beta · Drizzle + better-sqlite3 · React 19 + Vite 8 · Tailwind v4 + shadcn/ui · electron-vite 6.

## Before saying a task is done

All three must pass. No exceptions.

```
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test` runs through Electron's Node via `ELECTRON_RUN_AS_NODE=1` so native modules load with the right ABI. Don't replace it with a plain `vitest` invocation.

## Repo-specific invariants

- **Every mutation is a domain event** (`packages/domain/src/events.ts`). Services emit events; projections apply them. Never write directly to projection tables from service code.
- **`applyEvent` must be deterministic.** No `Date.now()`, no `crypto.randomUUID()`, no reading env. If a field needs a timestamp, put it on the event.
- **Event schema evolves additively.** New fields are optional. Never rename or remove an event type — deprecate + add.
- **Renderer stays thin.** It imports `@worth/ui`, `@worth/ipc` (schemas only), and type-only from `@worth/domain`. Never imports `@worth/core`, `@worth/db`, `@worth/sync` runtime, or `better-sqlite3`.

## Where to look

- `docs/DESIGN.md` — architecture, package layout, data model, sync design.
- `docs/ROADMAP.md` — what's shipped, what's next, known followups.
- `docs/GOTCHAS.md` — framework-specific quirks. Check here first when something breaks in an unfamiliar way.
