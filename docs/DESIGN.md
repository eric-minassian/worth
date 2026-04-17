# Worth — Design Document

**Status:** Draft v1 · 2026-04-16
**Scope:** Architecture for v1 (Electron desktop app) with forward-compatible decisions for the eventual self-hosted server + mobile client.

---

## 1. Goals

Worth is a personal-finance powerhouse. v1 proves the foundation.

**v1 must deliver:**
- Accounts (manual, any number)
- Transaction import (manual entry + CSV) with dedup
- Categorization (user-defined categories, manual assignment, simple rules)
- Browse / search / filter transactions
- Basic account balances and a transaction ledger view
- Runs as a single-user Electron app with a local SQLite database

**v1 architecture must make the following feasible later, without a rewrite:**
- A self-hosted HTTP server that syncs with one or more clients owned by the same user (Electron, future mobile)
- Offline-first clients with Google-Docs-style convergent sync
- Investment tracking (positions, lots, prices, cost basis)
- Multi-currency
- Additional importers (OFX/QFX, Plaid, broker exports)
- Budgets, net worth over time, reports, forecasting

## 2. Non-goals (v1)

- Multi-tenant SaaS (we are single-tenant self-hosted forever)
- Investment tracking UI (schema stubs only if cheap)
- Multi-currency UI (USD only; schema supports currency column)
- Mobile app
- Server binary
- Cloud auth, 2FA, account recovery

Explicitly deferred — we design to support them, we do not build them.

## 3. Guiding principles

1. **Local-first.** The client owns a complete, functional copy of the user's data. The server, when it exists, is a sync hub — not a source of truth the client depends on to work.
2. **Event-sourced core.** Every change is an append-only domain event. Projected tables are rebuildable from the event log. This is the single decision that makes both undo and sync tractable.
3. **Effect everywhere non-UI.** Services, schemas, error channels. One runtime in the Electron main process.
4. **Boundaries over layers.** The IPC boundary between Electron main and renderer is shaped identically to the eventual HTTP boundary between mobile and server. Swap the transport, keep the services.
5. **Plugins, not forks.** Importers are plugins with one stable contract. Adding OFX or Plaid later must not require touching core.
6. **Small v1 surface, firm v1 foundations.** Ship less; get the data model, event log, and sync substrate right.

## 4. High-level architecture

```
                        ┌────────────────────────────────┐
                        │           Electron app         │
                        │                                │
  ┌────────────┐  IPC   │  ┌──────────┐   ┌───────────┐  │
  │  Renderer  │◄──────►│  │  Main    │   │  SQLite   │  │
  │  (React)   │        │  │  (Effect │◄─►│  (file)   │  │
  │            │        │  │  runtime)│   │           │  │
  └────────────┘        │  └─────┬────┘   └───────────┘  │
                        │        │                       │
                        └────────┼───────────────────────┘
                                 │
                                 │ (future) HTTP + event stream
                                 ▼
                        ┌────────────────────────────────┐
                        │     Self-hosted Sync Server    │
                        │   (Node + Effect + SQLite/PG)  │
                        └────────────────────────────────┘
                                 ▲
                                 │
                        ┌────────┴───────┐
                        │  Mobile client │
                        │   (future)     │
                        └────────────────┘
```

Every box above — main process, future server, future mobile — runs the same core packages: `domain`, `db`, `core`, `sync`, `importers`. What differs is the transport and the UI shell.

## 5. Monorepo layout

Package manager: **pnpm workspaces**. Node ≥ 22. TypeScript strict, `noUncheckedIndexedAccess`.

```
worth/
├── apps/
│   └── electron/                     # Electron shell + Vite renderer
│       ├── src/
│       │   ├── main/                 # main process entry, IPC handlers, Effect runtime
│       │   ├── preload/              # typed IPC bridge
│       │   └── renderer/             # React app
│       └── electron.vite.config.ts
├── packages/
│   ├── domain/                       # Effect Schema types, branded primitives, event definitions
│   ├── db/                           # Drizzle schema + migrations + typed client
│   ├── core/                         # Business logic as Effect services
│   ├── sync/                         # Event log, HLC, sync protocol (stubbed in v1)
│   ├── importers/                    # Importer contract + CSV importer
│   ├── ui/                           # shadcn components + app-specific composites
│   └── ipc/                          # Typed IPC contract shared by main + preload + renderer
├── tooling/
│   ├── tsconfig/                     # Shared base tsconfigs
│   └── eslint/                       # Shared eslint config
├── docs/
│   └── DESIGN.md
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

Why `packages/ipc` is its own package: the contract is used by three runtimes (main, preload, renderer) and must import cleanly from each. Keeping it isolated from `core` keeps the renderer free of Effect runtime imports it doesn't need.

## 6. Domain model

Effect Schema defines every domain type. These become the source of truth for validation, TypeScript types, and (eventually) wire serialization.

### 6.1 Primitives

```ts
// packages/domain/src/primitives.ts
import { Schema as S } from "effect"

export const AccountId   = S.String.pipe(S.brand("AccountId"))
export const TxnId       = S.String.pipe(S.brand("TxnId"))
export const CategoryId  = S.String.pipe(S.brand("CategoryId"))
export const EventId     = S.String.pipe(S.brand("EventId"))   // ULID
export const DeviceId    = S.String.pipe(S.brand("DeviceId"))  // per-install UUID

export const CurrencyCode = S.String.pipe(
  S.pattern(/^[A-Z]{3}$/),
  S.brand("CurrencyCode"),
)

// Money as integer minor units + currency. Never float.
export const Money = S.Struct({
  minor:    S.BigIntFromSelf,        // signed; negative allowed for debits/liabilities
  currency: CurrencyCode,
})
```

### 6.2 Entities

```ts
export const AccountType = S.Literal("checking", "savings", "credit", "cash", "other")

export const Account = S.Struct({
  id:        AccountId,
  name:      S.String,
  type:      AccountType,
  currency:  CurrencyCode,
  createdAt: S.Date,
  archivedAt: S.optional(S.Date),
})

export const Transaction = S.Struct({
  id:          TxnId,
  accountId:   AccountId,
  postedAt:    S.Date,                // when it hit the account
  amount:      Money,                  // signed; negative = outflow
  payee:       S.String,
  memo:        S.optional(S.String),
  categoryId:  S.optional(CategoryId),
  importHash:  S.optional(S.String),   // stable hash of source row, for dedup
  createdAt:   S.Date,
  updatedAt:   S.Date,
})

export const Category = S.Struct({
  id:       CategoryId,
  name:     S.String,
  parentId: S.optional(CategoryId),
  color:    S.optional(S.String),
})
```

### 6.3 Domain events

Events are the write interface to the system. Every mutation is an event; projected tables are a read optimization.

```ts
// packages/domain/src/events.ts
export const AccountCreated = S.TaggedStruct("AccountCreated", {
  id: AccountId, name: S.String, type: AccountType, currency: CurrencyCode,
})

export const TransactionImported = S.TaggedStruct("TransactionImported", {
  id: TxnId, accountId: AccountId, postedAt: S.Date,
  amount: Money, payee: S.String, memo: S.optional(S.String),
  importHash: S.optional(S.String),
})

export const TransactionCategorized = S.TaggedStruct("TransactionCategorized", {
  id: TxnId, categoryId: S.NullOr(CategoryId),
})

export const TransactionEdited = S.TaggedStruct("TransactionEdited", {
  id: TxnId, patch: S.Struct({
    postedAt: S.optional(S.Date),
    amount:   S.optional(Money),
    payee:    S.optional(S.String),
    memo:     S.optional(S.NullOr(S.String)),
  }),
})

export const TransactionDeleted = S.TaggedStruct("TransactionDeleted", { id: TxnId })

export const CategoryCreated = S.TaggedStruct("CategoryCreated", {
  id: CategoryId, name: S.String, parentId: S.optional(CategoryId),
})

export const DomainEvent = S.Union(
  AccountCreated, TransactionImported, TransactionCategorized,
  TransactionEdited, TransactionDeleted, CategoryCreated,
)
```

Each event carries enough information to reconstruct the affected state without reading anything else. No event references a server-assigned id. This is what makes offline creation + later sync clean.

## 7. Event-sourced storage

### 7.1 Tables (drizzle)

The database has two kinds of tables:

**(a) The event log** — append-only, the system of record:

```
events
  event_id     TEXT PK         -- ULID, client-generated
  device_id    TEXT NOT NULL
  hlc          TEXT NOT NULL   -- hybrid logical clock string, sortable
  type         TEXT NOT NULL   -- discriminator from DomainEvent
  payload      TEXT NOT NULL   -- JSON-encoded event body
  created_at   INTEGER NOT NULL
  server_seq   INTEGER          -- NULL until confirmed by server (v1: always NULL)
  INDEX (hlc)
  INDEX (server_seq)
```

**(b) Projections** — derived, rebuildable, optimized for reads:

```
accounts, transactions, categories, ...
```

Every mutation path:

1. Validate incoming command against schema.
2. Build one or more domain events.
3. Begin transaction. Append events to `events`. Apply projections. Commit.
4. Emit a renderer notification over IPC (`eventsAppended`) so the UI invalidates relevant queries.

Reads go straight against projections — we do not replay events at read time. The event log is for sync, audit, and rebuild.

### 7.2 Why not pure CRDT

For finance data, the vast majority of operations are effectively commutative: importing a transaction, creating a category, recording a new account. The few truly concurrent-edit cases (two devices recategorizing the same transaction while offline) are resolved with **last-writer-wins by HLC** with a deterministic `device_id` tiebreak. We surface the conflict to the user only when a projection would be clobbered — i.e., we log both events and always apply the higher-HLC one. This is dramatically simpler than a full CRDT and sufficient for the data shape.

### 7.3 Projection rebuilds

A `rebuildProjections` effect truncates projection tables and replays every event in HLC order. Used for:
- Schema migrations of projection tables (projection changes do not require replaying history on-server).
- Debugging.
- A future "repair" UI affordance.

Event schema evolution uses additive versioning: new fields are optional; old events stay replayable.

## 8. Sync design (forward-looking, v1 stubs the protocol)

### 8.1 Concepts

- **Device.** An install of a client. Each device generates a stable UUID at first launch.
- **Hybrid Logical Clock (HLC).** `<physical ms>:<logical counter>:<device_id>`. Sortable as a string. On every event emission, HLC advances past both wall clock and the highest HLC the device has observed (from remote events).
- **Server sequence.** A monotonic integer assigned by the server when it durably persists a received event. Clients use `max(server_seq)` as their "known up to" watermark.

### 8.2 Protocol (future, shape fixed now)

```
POST /sync/push      { events: DomainEvent[] }           → { accepted: server_seq[] }
GET  /sync/pull?since=<server_seq>                        → { events, nextCursor, done }
GET  /sync/subscribe (SSE or WebSocket)                   → live push of new server_seq
```

Events are idempotent: re-pushing the same `event_id` is a no-op server-side.

### 8.3 Why this works for finance

- **Imports are idempotent** by `importHash`; dedup happens in the projection, not the log.
- **Edits are represented as patches on an id**, so two devices editing different fields merge cleanly.
- **Deletes are tombstones** (event, not a row removal). Convergence is automatic.

### 8.4 v1 implementation

`packages/sync` ships with:
- HLC implementation and tests.
- Event ID generation (ULID).
- Event log schema + append/read helpers.
- No network. The server + push/pull endpoints are stubs with types only.

This means the v1 Electron app already produces a valid event log. Turning on sync later is additive.

## 9. Effect service layer

### 9.1 Service shape

Every capability is an Effect service — a `Context.Tag` with a concrete `Layer`. This is the v4 style and gives us trivial swap-in for tests.

```ts
// packages/core/src/TransactionService.ts
import { Context, Effect, Layer } from "effect"

export class TransactionService extends Context.Tag("TransactionService")<
  TransactionService,
  {
    readonly import: (
      input: ImportInput,
    ) => Effect.Effect<ImportResult, ImportError>
    readonly list: (
      query: TxnQuery,
    ) => Effect.Effect<readonly Transaction[]>
    readonly categorize: (
      id: TxnId, categoryId: CategoryId | null,
    ) => Effect.Effect<void>
    readonly edit: (
      id: TxnId, patch: TxnPatch,
    ) => Effect.Effect<void, NotFound>
    readonly delete: (id: TxnId) => Effect.Effect<void, NotFound>
  }
>() {}

export const TransactionServiceLive = Layer.effect(
  TransactionService,
  Effect.gen(function* () {
    const db = yield* Db
    const events = yield* EventLog
    // ... implementation
    return { import: ..., list: ..., categorize: ..., edit: ..., delete: ... }
  }),
)
```

### 9.2 Runtime composition

The main process assembles a single runtime at boot and reuses it for every IPC request:

```ts
// apps/electron/src/main/runtime.ts
const AppLive = Layer.mergeAll(
  DbLive,
  EventLogLive,
  TransactionServiceLive,
  AccountServiceLive,
  CategoryServiceLive,
  ImporterRegistryLive,
)

export const runtime = ManagedRuntime.make(AppLive)
```

Shutting the app down disposes the runtime, which closes the DB handle.

### 9.3 Errors

All domain errors are tagged `Data.TaggedError` classes (`NotFound`, `ImportError`, `DuplicateImport`, `SchemaError`, …). The IPC layer serializes them to a stable discriminated union; the renderer decodes back to the same tagged shape. **No thrown exceptions cross the IPC boundary** — every failure is in the error channel.

## 10. IPC boundary

The boundary is small, typed, and idempotent where possible.

### 10.1 Contract package

`packages/ipc` exports:
- The full command/query surface as a discriminated union of `{ kind, input, output, error }` tuples.
- Effect-Schema codecs for each arm (so every payload is validated at the boundary).
- A typed `callIpc<K>(kind, input)` helper for the renderer.

### 10.2 Transport

Single generic channel: `ipcMain.handle("rpc", async (_ev, msg) => ...)`. The preload script exposes `window.worth.rpc(msg)`. On every receive the main process:

1. Decodes `msg` with Schema.
2. Dispatches to the appropriate service call.
3. Runs the effect in the shared runtime.
4. Encodes success/error back through Schema.

### 10.3 Why one channel instead of one IPC method per command

It means the renderer ships exactly one preload surface, and swapping IPC for HTTP later is literally replacing `window.worth.rpc` with `fetch("/rpc", ...)`. The over-the-wire shape is identical to what the future mobile client will use.

### 10.4 Subscriptions

For change notifications (`eventsAppended`, `projectionUpdated`), the main process sends a second channel (`ipcMain` → `webContents.send`). The renderer wraps this as a TanStack Query invalidation source. Over HTTP this becomes SSE.

## 11. Database

### 11.1 Driver

`better-sqlite3` in the Electron main process. Synchronous, fast, battle-tested. Opened once at startup, WAL mode on.

### 11.2 Drizzle

- Schema lives in `packages/db/src/schema/*.ts`.
- Migrations generated via `drizzle-kit`, committed to `packages/db/migrations/`.
- Migrations run on app boot before the runtime accepts IPC.
- The Drizzle client is wrapped as an Effect service (`Db`) so that tests can substitute an in-memory SQLite with the same schema.

### 11.3 Where the DB file lives

Electron's `app.getPath("userData") + "/worth.db"`. A `WORTH_DB_PATH` env var overrides for dev/testing.

### 11.4 Future server DB

The same drizzle schema, pointed at either SQLite or Postgres. The event log and projection tables are portable. We do not assume Postgres-only features in v1.

## 12. Money and currency

- Amount stored as `BigInt` minor units. Column type `INTEGER` in SQLite (64-bit).
- Every monetary column carries its own `currency` column. No implicit currency.
- A `Money` value object in `packages/domain` with add/subtract/negate/zero helpers, all typed so `Money<USD>` cannot be added to `Money<EUR>` without an explicit conversion call.
- v1 locks the UI to USD but the domain and DB are already multi-currency-ready. When we add currencies, the change is a UI toggle + an FX-rate service, not a schema migration.

## 13. Importer plugin architecture

### 13.1 Contract

```ts
// packages/importers/src/Importer.ts
export interface Importer<RawRow = unknown> {
  readonly id: string                             // "csv.generic", "csv.chase", ...
  readonly name: string
  readonly canHandle: (input: ImporterInput) => boolean
  readonly parse: (
    input: ImporterInput,
    ctx: ImporterContext,
  ) => Effect.Effect<ImporterOutput, ImportError>
}

export interface ImporterOutput {
  readonly events: readonly DomainEvent[]         // typically TransactionImported[]
  readonly warnings: readonly string[]
}
```

An importer produces **events**, not rows. It never writes to the DB directly. The `TransactionService.import` method:

1. Runs the importer to get events.
2. Filters events whose `importHash` already exists in the projection (dedup).
3. Appends the remaining events transactionally.

### 13.2 v1 importer

`csv.generic` with configurable column mapping (date / payee / amount / memo). Chase/Amex/etc. become presets on top.

### 13.3 Future importers

- `ofx` / `qfx` parsers
- `plaid` (needs a proxy through the self-hosted server; Plaid keys must not live on the client)
- Brokerage statements, which will emit future `InvestmentTransactionImported` events the same way

Investments are additive: new event types, new projection tables, no churn on existing code.

## 14. UI

### 14.1 Stack

- React 19, Vite, Tailwind v4, shadcn.
- TanStack Query for server-state cache keyed on IPC command shape.
- TanStack Router for routing (file-based, typed).
- Forms via react-hook-form + Effect Schema resolver.

### 14.2 Structure

- `packages/ui` holds generic shadcn primitives (Button, Dialog, Table, …) plus app-level composites that are used across multiple pages (TransactionRow, AmountCell, AccountPicker).
- `apps/electron/src/renderer` holds route components and page-level state.
- Renderer has **no** Effect runtime. It calls IPC and consumes plain data.

### 14.3 v1 screens

- Onboarding (create first account)
- Accounts list + detail
- Transactions view (filter, search, bulk categorize)
- Import modal (file → preview → commit)
- Categories management
- Settings (DB path, export event log)

## 15. Auth (future)

Single-tenant self-hosted. The owning user configures the server at install time:

- A single server secret generated on first server start.
- Each client exchanges a one-time pairing code for a long-lived device token.
- All `/sync/*` requests carry the device token.
- No account recovery, no email, no password reset. If you lose the server, you restore from backup.

We do not build any of this in v1. The shape is fixed so it fits the sync protocol above without modification.

## 16. Testing

- **Unit:** Vitest on each package. Effect services are tested by providing an in-memory `DbLive` + test clock.
- **Integration:** The `core` package has an integration harness that boots the real SQLite in a tmp file and drives services through IPC-shaped commands — this is the same surface the UI exercises, so UI bugs at the boundary get caught.
- **Renderer:** Playwright against a built Electron binary for critical paths (create account, import CSV, categorize).
- **Property tests:** HLC ordering, event replay determinism (replaying any two permutations that respect HLC order yields identical projections).
- No mocks for the DB. The real driver in a tmp file is fast enough and catches migration bugs.

## 17. Tooling

- `pnpm` workspaces, `turbo` for task orchestration.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- ESLint flat config, Prettier.
- `tsc --noEmit` as the typecheck gate; no emitting from packages (bundler handles it per-app).
- `electron-builder` for packaging.
- CI: typecheck + lint + unit tests + integration tests on every push. Playwright on main + release branches.

## 18. Open questions

1. **Undo UX.** Events make undo trivial mechanically (emit a compensating event). Do we surface a user-visible undo queue, or only recent-action undo? Defer.
2. **Encrypted DB at rest.** SQLite + SQLCipher works with `better-sqlite3-multiple-ciphers`. Cost: native build complexity. Recommend: defer until sync ships, at which point the user's data leaves their machine and encryption matters more.
3. **Rules engine for categorization.** Start with literal-match rules (payee contains, amount equals). Punt regex/ML to later.
4. **Backup format.** Design call: ship the event log as the canonical export. Every other format (CSV, JSON of projections) is lossy derivative.

## 19. Milestone plan

Each milestone is shippable — the app runs and does something useful at the end of each.

**M0 — Skeleton (1 chunk of work)**
- pnpm workspace, tsconfig, eslint, prettier, CI scaffold
- Empty `packages/domain`, `packages/db`, `packages/core`, `packages/ipc`, `packages/ui`, `packages/sync`, `packages/importers`
- `apps/electron` boots a blank window
- "hello world" IPC round-trip through the single RPC channel

**M1 — Accounts + manual transactions**
- Domain schemas and events for accounts, transactions, categories
- Drizzle schema + migrations
- `EventLog` service, HLC, append/read
- `AccountService`, `TransactionService`, `CategoryService` with full CRUD through events
- IPC contract wired
- UI: accounts list, create account, transaction list, manual entry form, categorize
- Vitest + one Playwright smoke test

**M2 — CSV import + dedup**
- `packages/importers` contract + `csv.generic`
- Import modal (file picker → column mapping → preview → commit)
- `importHash` dedup in `TransactionService.import`
- Tests: round-trip a Chase CSV sample

**M3 — Sync substrate (no network)**
- HLC hardening + property tests
- Event log export/import (JSON over filesystem)
- Projection rebuild command
- Documented sync protocol types in `packages/sync`

**M4 and beyond** (out of scope for this doc): self-hosted server package, pairing flow, mobile client, investments.

---

## Appendix A — Package dependency graph

```
apps/electron
  ├── packages/ui
  ├── packages/ipc
  └── packages/core ── packages/sync ── packages/domain
                  └── packages/db  ─────┘
                  └── packages/importers ─ packages/domain
```

Rules:
- `domain` depends on nothing but `effect`.
- `db` depends on `domain` + `drizzle-orm`.
- `core` depends on `domain`, `db`, `sync`, `importers`.
- `ipc` depends on `domain` only (no Effect runtime, just Schema).
- `ui` depends on nothing in our packages (it's pure shadcn + React).
- `apps/electron/renderer` never imports `core`, `db`, or `sync`.

This keeps the renderer bundle small and the contract boundary honest.

## Appendix B — Why not Tauri / Neutralino / plain web

- **Tauri** would be a strong choice and we may revisit. Rust toolchain raises the bar for contributors; ecosystem for desktop-grade file dialogs / OS integrations is younger than Electron's. Not a no — a "later, maybe."
- **Plain PWA** breaks the local-first story — hard to guarantee durable SQLite-on-disk semantics in a browser, and there is no mobile story.
- **Electron** is boring and it works. The cost is bundle size and memory, both acceptable for a desktop finance app.
