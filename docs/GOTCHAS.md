# Gotchas

Stack-specific quirks that will eat a session if you don't know them. Check here first when something breaks in an unfamiliar way.

## Effect v4 beta

v4 renamed / reshaped several v3 APIs. Common mistakes:

- **Services.** `Context.Service<Self, Shape>()("id") {}`. `Context.Tag` is gone.
- **Schema rest args became arrays.** `Schema.Union([...])`, `Schema.Literals([...])`, `Schema.Record(key, value)`.
- **Decoders return `Result`, not `Either`.** `Schema.decodeUnknownResult(S)(input)` returns `{ _tag: "Success", success }` or `{ _tag: "Failure", failure }`. `decodeUnknownEither` is gone.
- **Scoped layers.** `Layer.effect(Service)(effect)` replaces v3 `Layer.scoped`.
- **Cause inspection.** `Cause.findErrorOption` replaces `Cause.failureOption`.
- **CommandDef generics.** Bound schemas by `Schema.Top`, not `Schema.Schema<T>`. The latter is too loose for decoders that require `never` services and will produce confusing "not assignable to parameter of type 'Decoder<unknown, never>'" errors.

## Native modules (better-sqlite3)

- `better-sqlite3` is native. Electron ships its own Node with a different ABI than system Node. You get one `better_sqlite3.node` binary; it has to match the runtime that loads it.
- `apps/electron` `postinstall` runs `electron-rebuild -f -w better-sqlite3` on every install. That leaves the binary ABI-compatible with Electron.
- Tests use `ELECTRON_RUN_AS_NODE=1` + `scripts/electron-vitest.mjs` so vitest runs under Electron's Node and uses the same binary. **Do not revert to plain `vitest`** — it'll fail to load the native module.
- Adding another native dep? Add it to `apps/electron` `rebuild:native` script's `-w` list and to pnpm's `onlyBuiltDependencies` allowlist in the root `package.json`.

## Shadcn + Tailwind v4 in a monorepo

- Shadcn writes components to `packages/ui/src/components/ui/*.tsx` and imports them from `@worth/ui/components/ui/*` / `@worth/ui/lib/utils`.
- Self-reference resolves two ways:
  - **TypeScript**: `packages/ui/tsconfig.json` has `paths: { "@worth/ui/*": ["./src/*"] }`.
  - **Vite/Node**: `packages/ui/package.json` `exports` has wildcards for `./components/*`, `./lib/*`, `./hooks/*`.
- Renderer `apps/electron/src/renderer/index.css` needs `@source "../../../../packages/ui/src"` so Tailwind scans shadcn class usage across the workspace. If shadcn files move, update the `@source` path.
- Tailwind v4 has no `tailwind.config.js`. Theme vars + `@theme inline` mapping live in `packages/ui/src/styles.css`. Do not create a config file.
- `packages/ui` lists `tailwindcss` as a devDep so its CSS can `@import "tailwindcss"` — pnpm's isolated mode won't resolve it from a parent package.

## Drizzle + SQLite

- `integer()` column supports `mode: "number" | "boolean" | "timestamp" | "timestamp_ms"`. **No native bigint mode on integer.** Only `blob({ mode: "bigint" })` supports BigInt storage, and that uses BLOB rather than INTEGER (you lose sorting/indexing).
- We store amounts in `integer { mode: "number" }` and convert at the service boundary: `Number(money.minor)` on write, `BigInt(row.amountMinor)` on read. Cap is `Number.MAX_SAFE_INTEGER` minor units (~90 trillion USD) — fine.
- We use raw ms-since-epoch numbers for timestamps (not `timestamp_ms` mode) because events already carry that shape.

## Electron packaging

- `apps/electron/package.json` intentionally **does not** set `"type": "module"`. That keeps main/preload outputs CJS; `__dirname` works directly; no ESM preload version dance. Renderer is ESM — Vite handles it regardless.
- `electron.vite.config.ts` has `build.externalizeDeps: { exclude: [...@worth packages] }` so workspace packages are **bundled into** main and preload. Without this, Node's ESM loader tries to resolve extensionless imports from workspace sources (`export * from "./primitives"`) and fails.
- Preload loads as a regular script, not a module. Keep it simple.

## TypeScript 6

- `baseUrl` is deprecated. `paths` works without it — paths resolve relative to the tsconfig file.
- `moduleResolution: "Bundler"` + package.json `exports` is enough for self-referencing a workspace package; no `paths` entry needed unless shadcn or another tool requires it.
- With `verbatimModuleSyntax: true`, use `import type { … }` for type-only imports — regular import of type-only symbols fails.

## Event determinism

- Every event that updates a projection field must carry every value that field depends on. Non-deterministic reads inside `applyEvent` break rebuild: the live projection and the replayed projection diverge.
- We hit this with `TransactionCategorized` missing an `at` field; `applyEvent` called `Date.now()`; the property test caught it. Don't repeat.
- When adding a new event type: run `pnpm test` and confirm the property test in `packages/core/test/projection.property.test.ts` still passes. If it fails, your event is missing a field.

## HLC

- Format: `<ms:13>.<counter:5>.<deviceId>`. Zero-padded so string comparison matches logical ordering.
- `makeHlcClock` takes an `onAdvance` callback — the Electron runtime uses it to persist `meta.last_hlc` on every tick so the clock is monotonic across restarts. If you instantiate a clock somewhere new, wire this up or the clock will regress.
- `recv` throws if remote HLC is more than `MAX_DRIFT_MS` (60s) from local wall-clock. This is a correctness guard, not a bug — adjust only if you understand the implications for sync convergence.
