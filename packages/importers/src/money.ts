/**
 * Parse a signed decimal amount into BigInt minor units (cents for two-decimal
 * currencies). Handles `$`, thousand separators, leading `-`, and parens for
 * negatives. Returns null if the input is not a recognizable number.
 *
 * Used by both CSV column-mapping and OFX `<TRNAMT>` extraction.
 */
export const parseAmount = (value: string): bigint | null => {
  let s = value.trim()
  if (s === "") return null
  let negative = false
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.startsWith("-")) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith("+")) {
    s = s.slice(1)
  }
  s = s.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null
  const [whole = "0", frac = ""] = s.split(".")
  const twoDigitFrac = (frac + "00").slice(0, 2)
  const minor = BigInt(`${whole}${twoDigitFrac}`)
  return negative ? -minor : minor
}
