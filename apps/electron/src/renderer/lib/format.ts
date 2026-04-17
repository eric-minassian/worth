import type { AccountType, Money } from "@worth/domain"

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit",
  cash: "Cash",
  other: "Other",
}

/** Tailwind classes for a signed money amount in a right-aligned table cell. */
export const amountClass = (minor: bigint): string =>
  minor < 0n
    ? "text-right font-medium tabular-nums text-destructive"
    : "text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400"

/** Format a Money value as a localized currency string. */
export const formatMoney = (money: Money, locale = "en-US"): string => {
  const minor = Number(money.minor)
  const major = minor / 100
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  }).format(major)
}

/** Parse a user-entered decimal string (e.g. "-12.50") into minor units (bigint). */
export const parseMoneyMinor = (input: string): bigint | null => {
  const trimmed = input.trim()
  if (trimmed === "") return null
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const negative = trimmed.startsWith("-")
  const abs = negative ? trimmed.slice(1) : trimmed
  const [whole = "0", frac = ""] = abs.split(".")
  const paddedFrac = (frac + "00").slice(0, 2)
  const digits = `${whole}${paddedFrac}`
  const minor = BigInt(digits)
  return negative ? -minor : minor
}

/** Format a ms-timestamp as a short date string. */
export const formatDate = (ms: number, locale = "en-US"): string =>
  new Date(ms).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })

/** Convert ms-timestamp to a yyyy-mm-dd string for a date input. */
export const toDateInput = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Convert a yyyy-mm-dd string to a ms-timestamp (local midnight). */
export const fromDateInput = (value: string): number => new Date(`${value}T00:00:00`).getTime()
