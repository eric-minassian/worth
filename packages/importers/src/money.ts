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
  // Accept up to 8 decimal places. Extra precision past 2 digits is
  // truncated — common in investment files where UNITPRICE carries 5–6
  // decimals (e.g. Vanguard's 138.98018).
  if (!/^\d+(\.\d{1,8})?$/.test(s)) return null
  const [whole = "0", frac = ""] = s.split(".")
  const twoDigitFrac = (frac + "00").slice(0, 2)
  const minor = BigInt(`${whole}${twoDigitFrac}`)
  return negative ? -minor : minor
}

/**
 * Parse a decimal share quantity into signed BigInt micro-share units (1e-8).
 * OFX reports fractional shares with up to 8 decimal places (`<UNITS>10.5`),
 * so scaling by 1e8 keeps everything in integer arithmetic downstream.
 */
export const parseQuantity = (value: string): bigint | null => {
  let s = value.trim()
  if (s === "") return null
  let negative = false
  if (s.startsWith("-")) {
    negative = true
    s = s.slice(1)
  } else if (s.startsWith("+")) {
    s = s.slice(1)
  }
  s = s.replace(/[,\s]/g, "")
  if (!/^\d+(\.\d{1,8})?$/.test(s)) return null
  const [whole = "0", frac = ""] = s.split(".")
  const eightDigitFrac = (frac + "00000000").slice(0, 8)
  const units = BigInt(`${whole}${eightDigitFrac}`)
  return negative ? -units : units
}
