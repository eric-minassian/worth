// Launches Vitest using Electron's bundled Node (via ELECTRON_RUN_AS_NODE=1)
// so native modules like better-sqlite3 — which are rebuilt against Electron's
// ABI on install — load cleanly under tests without ever swapping binaries.
//
// Invoked as:
//   ELECTRON_RUN_AS_NODE=1 electron scripts/electron-vitest.mjs [vitest args...]

import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const vitestPkgJson = require.resolve("vitest/package.json")
const vitestCli = path.join(path.dirname(vitestPkgJson), "vitest.mjs")

// Vitest reads `process.argv[1]` as its entry; rewrite so it matches the
// normal `node vitest.mjs …` invocation.
process.argv = [process.argv[0], vitestCli, ...process.argv.slice(2)]

await import(vitestCli)
