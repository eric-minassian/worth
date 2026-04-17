import Papa from "papaparse"

export interface ParsedCsv {
  readonly headers: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

/**
 * Parse a CSV string. The first row is treated as the header. Empty trailing
 * rows are dropped. Cells are trimmed.
 */
export const parseCsv = (text: string): ParsedCsv => {
  const result = Papa.parse<readonly string[]>(text.trim(), {
    skipEmptyLines: true,
    transform: (value) => value.trim(),
  })
  const all = result.data.filter((row) => row.length > 0 && row.some((c) => c !== ""))
  if (all.length === 0) return { headers: [], rows: [] }
  const [headers = [], ...rows] = all
  return { headers, rows }
}
