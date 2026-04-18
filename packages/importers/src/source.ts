/**
 * Prefix-based identification of an imported transaction's source. Kept in a
 * crypto-free module so the renderer can import it without pulling `node:crypto`.
 * The prefixes are the shared protocol between hash computation and the UI —
 * both sides must agree.
 */

export const IMPORT_SOURCE_PREFIX = {
  csv: "csv:",
  ofx: "ofx:",
} as const

export type ImportSource = "csv" | "ofx" | "manual" | "unknown"

export const importSourceOf = (hash: string | null): ImportSource => {
  if (hash === null) return "manual"
  if (hash.startsWith(IMPORT_SOURCE_PREFIX.csv)) return "csv"
  if (hash.startsWith(IMPORT_SOURCE_PREFIX.ofx)) return "ofx"
  return "unknown"
}
