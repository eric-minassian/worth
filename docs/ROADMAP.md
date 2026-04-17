# Worth — Forward Plan & Context

**Purpose:** Hand-off context for future work. Companion to `docs/DESIGN.md` (architecture) and `CLAUDE.md` / this repo's code (source of truth). **Not a design — intentionally leaves the "how" open.**

**Status:** M0 – M3 shipped. See "Current state" for the concrete inventory.

---

## 1. Product intent (unchanging constraints)

These are load-bearing. Any future work should respect them.

- **Local-first.** Every client owns a complete, functional copy of the user's data and works offline. A server, when it exists, is a sync hub — never a source of truth clients depend on to function.
- **Single-tenant self-hosted.** Worth is for one user (possibly multi-device). It is **not** a multi-tenant SaaS and will not grow that way.
- **Event-sourced core.** Every mutation is an append-only domain event. Projections are derived and can be rebuilt from the log at any time. The event log is the canonical backup format; every other format is a lossy derivative.
- **Deterministic event application.** `applyEvent(event)` must be pure with respect to the event's contents. Do not read clocks, IDs, or env inside projection handlers — events must carry every value they need.
- **Money is BigInt minor units + ISO currency code.** Never float. USD-only UI today; schema is multi-currency-ready.
- **HLC-ordered sync.** Hybrid Logical Clocks + monotonic `server_seq` (when the server exists). Conflict resolution is last-writer-wins by HLC with deterministic `device_id` tiebreak. Most ops are commutative so this is sufficient without full CRDTs.
- **Event-schema evolution is additive.** New fields are optional; old events stay replayable. Never rename or remove an event type; deprecate + add a new one.

## 2. Current state (what is already shipped)

### Monorepo
- `pnpm` workspaces. TypeScript 6 strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Packages: `@worth/domain`, `@worth/db`, `@worth/core`, `@worth/sync`, `@worth/importers`, `@worth/ipc`, `@worth/ui`.
- App: `apps/electron` (electron-vite 6 beta + Vite 8 + React 19 + Tailwind v4 + shadcn/ui).

### Functional surface (v1)
- Accounts, categories, transactions — CRUD via Effect services. Every mutation is a domain event; projections update in the same DB transaction.
- CSV import with header-based column-mapping suggestions, parens/symbol-aware amount parsing, dedup by `(accountId, importHash)`.
- Settings page: device id, last HLC, event + projection counts, export / import event log, rebuild projections.
- Native save/open dialogs (Electron `dialog.*`) for the export/import backup flow.

### Data substrate
- SQLite via `better-sqlite3` + Drizzle. WAL + FKs on. `events` + `_migrations` + per-entity projection tables.
- In-code migrations (no `drizzle-kit` runtime); one migration today.
- HLC persisted to `meta.last_hlc` on every advance so the clock survives restarts.
- EventLog exposes `append`, `appendAll` (bulk), `ingest` (pre-HLC'd events, idempotent on `event_id`, sorted by HLC before applying so FK order holds), `list`, `listRecordsSince`.

### Sync protocol
- Wire types defined in `@worth/sync/protocol`: `SyncEvent`, `PushRequest`/`PushResponse`, `PullRequest`/`PullResponse`, `SubscribeMessage` (tagged union for `EventsAppended` / `Heartbeat`), `ExportFile`.
- No network transport yet. The shape is the contract future transports implement.

### IPC
- Single `worth:rpc` channel with Schema-validated envelope. `packages/ipc` holds the command registry; handlers live in the main process and are dispatched via a `ManagedRuntime`. Same wire shape will become the HTTP `/rpc` surface.

### Tests
- Vitest runs through Electron's Node (`ELECTRON_RUN_AS_NODE=1`) so native modules are built once for Electron's ABI and reused by both app and tests.
- 45 tests: HLC + clock + HLC property tests, CSV parsing + mapping, service round-trips against `:memory:` SQLite, projection-determinism + export/ingest property tests (fast-check).

## 3. Milestone backlog (ordered)

### M4 — Self-hosted sync server

**Goal:** A single-tenant HTTP server a user runs on their own box. One or more clients (Electron today, mobile later) sync through it.

Known requirements:
- New workspace package `apps/server` (Node or Bun; prefer Node until a good reason to switch).
- Implements `POST /sync/push`, `GET /sync/pull`, `GET /sync/subscribe` (SSE) per the existing protocol schemas in `@worth/sync/protocol`.
- Storage: same Drizzle schema as the client, plus a `server_seq` autoincrement column populated on durable receipt. SQLite at first; design allows swap to Postgres without schema churn.
- Reuses `@worth/domain`, `@worth/db`, `@worth/core` (the event log is the same code).
- **Pairing flow.** First server launch generates a server secret. Each client exchanges a one-time pairing code for a long-lived device token. All sync requests carry the device token.
- Packaging: standalone binary or Docker image — user's call on shape; no decision yet.
- The server never originates events — it only relays. `deviceId` on every event is a client device.

Client-side changes that land with M4:
- Renderer Settings page gains a "Sync" section (server URL, pairing UI, sync status, last pulled `server_seq`).
- Replace the IPC-only RPC transport abstraction with one that also speaks HTTP to the server. The command registry stays identical; only the transport changes.
- Background sync loop: pull on launch + every N seconds (or on SSE notification), push newly-appended local events.
- Persist `last_pulled_server_seq` in `meta` (new key).

Known hazards:
- Avoid leaking per-request Electron session state into sync code — the same core needs to run server-side with no Electron.
- FK-order guarantees during ingest still rely on HLC ordering of sibling events. Keep that invariant.
- Don't introduce a second source of truth. The server writes to its own event log and reports back; clients persist locally.

### M5 — Mobile client

**Goal:** View + edit ledger on mobile, syncing through the M4 server.

Known requirements:
- React Native (Expo) or native — TBD; React Native is the likely pick for code reuse.
- Reuses `@worth/domain`, `@worth/ipc` (client side), `@worth/sync` (protocol). Core services may or may not be reusable depending on SQLite driver choice (`expo-sqlite` has a Drizzle adapter).
- Same event-log-first architecture. Events produced on mobile sync identically to events from the desktop app.
- Auth model is the same pairing flow as the desktop client.
- UI is read-mostly on launch; write paths prioritize CSV-less entry (single-tap add, split via keypad).

Open questions the agent should settle:
- Single binary or per-platform? (React Native covers both; native would mean two codebases.)
- How much UI code can we share with `apps/electron`? Probably little — mobile has fundamentally different navigation. Share the services/queries layer, not the views.

### M6 — Investments

**Goal:** Track positions, lots, prices, cost basis; show portfolio value over time.

New domain concepts (each becomes events + projection tables):
- `InvestmentAccount` (distinct `AccountType`?  or separate entity — design decision).
- `Holding` (instrument × account × quantity × avg cost basis).
- `Lot` (per-purchase lot for tax/FIFO accounting).
- `InvestmentTransaction` (buy, sell, dividend, split, transfer, fee) — each becomes its own event type.
- `Instrument` (symbol, name, type, currency, exchange).
- `PriceQuote` (instrument × timestamp × price) — may be fetched externally; store snapshots.

Requirements:
- Additive only — existing `Account` / `Transaction` flows must keep working exactly as they do today.
- Importers for brokerage CSVs and OFX/QFX. Plaid integration is a separate task and must route through the self-hosted server (Plaid keys never live on the client).
- External price data source — TBD. Could be Yahoo Finance scrape, IEX, or manual entry. Whatever it is, the PriceQuote event type is the internal truth; the source is just a feeder.

### M7+ — Analysis & workflows

These are individually small-to-medium tasks. Order them as the user asks.

- **Budgets.** Monthly/annual category caps. Event types: `BudgetCreated`, `BudgetAdjusted`, etc. Projection joins categories × month to compare spend vs budget.
- **Net worth over time.** Daily snapshots of account balances. Projection can be computed on demand from transactions; snapshots for perf.
- **Rules engine for categorization.** Literal-match (payee contains / amount equals) first. Regex later. ML much later. Rules are just events themselves (`RuleCreated` → projection applies retroactively + to new imports).
- **Reports / charts.** Cash flow, category breakdown, account balance trends. Uses Recharts (via shadcn's `Chart` wrapper) or equivalent.
- **Forecasting.** Given recurring transaction patterns, project balances forward.
- **Recurring transactions.** Declared recurrences that auto-create events on schedule.
- **Multi-currency UI.** Schema is already there; this is a UI pass + an FX-rate service (`PriceQuote` for currency pairs fits).
- **Undo UX.** Event compensation semantics are already there (emit inverse event). Surface as a recent-action undo queue.

## 4. Cross-cutting requirements

- **All wire formats are versioned.** `ExportFile.version`, future protocol messages should carry a version. Bumping the number is a breaking-change marker; the schema should evolve additively first.
- **Accessibility** — keyboard nav for every interactive element; screen-reader labels on dialogs and icon-only buttons (shadcn primitives already mostly handle this — don't regress).
- **No telemetry, no phone-home.** Worth is personal finance data. If a feature needs network egress (price quotes, Plaid), it must route through the user's own server.
- **Data export is always available.** The event log export is the escape hatch. Never ship a feature that produces state not representable as events.
- **Keep the renderer bundle free of Node-only code.** Renderer imports `@worth/ipc` (schemas only, no Effect runtime), `@worth/ui`, `@worth/domain` (type-only). It must not import `@worth/core`, `@worth/db`, `better-sqlite3`, or `@worth/sync` runtime (type-only protocol imports are fine).

## 5. Known followups / tech debt

Small-to-medium items that have been noted during prior work but not done. Good candidates for background cleanup passes.

- **`appendAll` integration in `ImportService.commit`.** `EventLog.appendAll` exists (single-transaction bulk). `ImportService.commit` currently appends one event per CSV row, i.e. one DB transaction per row. Collect dedup-survivors into an array, then one `appendAll`. Rough 10–50× speedup for large imports.
- **Light-mode toggle.** Currently hardcoded `<html class="dark">`. Add a system-pref-aware toggle. shadcn's CSS vars are already split `:root` / `.dark`, so the CSS is ready.
- **Playwright smoke test.** Deferred from M1. Should cover: create account → add transaction → CSV import → categorize → verify displayed values. Runs against a packaged or `electron-vite preview` build.
- **Encrypted DB at rest.** Relevant once sync ships (data leaves the machine). `better-sqlite3-multiple-ciphers` is the drop-in. Native build complexity is the cost. Defer until M4 is in flight.
- **Drizzle-kit migrations.** Today migrations are in-code SQL strings. Moving to `drizzle-kit generate` is valuable once the schema evolves past trivial. Bundle generated SQL as assets; use `drizzle-orm/better-sqlite3/migrator` at runtime.
- **Projection-schema migrations.** When a projection table's schema needs to change, the canonical path is: bump migrations, run `rebuildProjections` at startup (or on first launch after the migration lands). Event log is untouched.
- **Format pass.** `pnpm format` hasn't been enforced; minor churn expected the first time it runs against everything.
- **Logging.** No structured logger yet. Worth wiring up once we have anything that fails silently (sync loops, scheduled jobs).
- **Code signing + notarization.** Worth ships unsigned today. Without an Apple Developer Program membership, macOS users see Gatekeeper on first launch (right-click → Open) and the in-app updater cannot do in-place install — it falls back to opening the GitHub release page (see below).

### In-app updates (shipped, macOS-only)

- Worth currently targets macOS arm64 only. Windows and Linux builds are out of scope until explicit demand.
- `apps/electron/src/main/updater.ts` hits the GitHub Releases API directly, compares semver, and — when a newer version is found — surfaces a "open release page" action in Settings. Unsigned macOS builds cannot pass Squirrel.Mac's signature check, so in-place update is impossible; the user drags the new DMG into Applications themselves. Worth's data lives outside the bundle, so the swap is non-destructive.
- Two channels: **stable** (full GitHub releases from `v*` tags) and **nightly** (prereleases with version suffix `-nightly.*`, one per push to `main`). Channel preference persists in `meta.update_channel`. The renderer's API query filters by the `prerelease` flag on each release.
- Nightly version scheme: `X.Y.Z-nightly.<YYYYMMDDHHmm>.<shortsha>` — computed by `scripts/set-version.mjs --nightly`. The fixed-width timestamp is what makes lexicographic prerelease compare correct, so a newer nightly always sorts above an older one.
- `.github/workflows/ci.yml` runs typecheck + lint + test on PRs and main pushes (macos-14 runner — matches production Electron ABI so `better-sqlite3` needs no rebuild dance).
- Known followups: Apple Developer Program membership → code-signing + notarization → seamless in-place auto-update via electron-updater.

## 6. Gotchas

Framework-specific footguns that will eat a session if you don't know them live in [`docs/GOTCHAS.md`](./GOTCHAS.md). Check there first when something breaks in an unfamiliar way (Effect v4 API differences, native-module ABI, shadcn/Tailwind monorepo setup, Drizzle SQLite bigint, Electron packaging, event determinism, HLC).

## 7. Where to find things

- `docs/DESIGN.md` — v1 architecture, monorepo layout, domain model, sync design, milestones.
- `docs/ROADMAP.md` — this file.
- `packages/domain/src/events.ts` — the canonical list of event types. Start here when adding functionality.
- `packages/sync/src/protocol.ts` — wire format for sync (+ export).
- `packages/core/src/EventLog.ts` — the heart of the system. Most write paths funnel through here.
- `packages/core/src/events/apply.ts` — the projection handlers. Must stay deterministic.
- `packages/core/src/services/SystemService.ts` — export / import / rebuild plumbing.
- `apps/electron/src/main/runtime.ts` — how layers are composed; where the HLC clock is bootstrapped from the meta table.
- `apps/electron/src/main/handlers.ts` — maps IPC commands to service calls; the one place that speaks Electron (dialog, fs) directly.
