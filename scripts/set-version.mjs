#!/usr/bin/env node
// Writes a target version into apps/electron/package.json so electron-builder
// picks it up during `pnpm --filter @worth/electron dist`.
//
//   node scripts/set-version.mjs --nightly
//     → reads current "X.Y.Z" (strips any prerelease), appends
//       "-nightly.<YYYYMMDDHHmm>.<shortsha>"
//
//   node scripts/set-version.mjs --tag v1.2.3
//     → sets version to "1.2.3"

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const pkgPath = resolve(repoRoot, "apps/electron/package.json")

const args = process.argv.slice(2)
const mode = args[0]

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
const current = String(pkg.version ?? "0.0.0")
const [currentClean] = current.split("-")

let next
if (mode === "--nightly") {
  const sha = execSync("git rev-parse --short=8 HEAD", { cwd: repoRoot })
    .toString()
    .trim()
  const now = new Date()
  const pad = (n) => String(n).padStart(2, "0")
  const ts =
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes())
  next = `${currentClean}-nightly.${ts}.${sha}`
} else if (mode === "--tag") {
  const tag = args[1]
  if (!tag) {
    console.error("--tag requires a tag argument (e.g. v1.2.3)")
    process.exit(1)
  }
  next = tag.startsWith("v") ? tag.slice(1) : tag
} else {
  console.error("usage: set-version.mjs --nightly | --tag <vX.Y.Z>")
  process.exit(1)
}

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
// Echo for CI logs and for the workflow to capture.
console.log(next)
