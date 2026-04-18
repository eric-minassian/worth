import { parseAmount } from "./money"

// -- Types ------------------------------------------------------------------

export interface OfxAccount {
  /** `<BANKID>` for banks, `<BROKERID>` for brokerages, null for credit cards. */
  readonly institutionId: string | null
  /** `<ACCTID>` — the account number reported by the institution. */
  readonly accountId: string
  /** `<ACCTTYPE>` — CHECKING / SAVINGS / CREDITLINE / MONEYMRKT / CREDITCARD / null. */
  readonly accountType: string | null
  /** `<CURDEF>` — ISO currency code reported in the statement. */
  readonly currency: string | null
}

export interface OfxTransaction {
  readonly fitid: string
  /** ms since epoch, parsed from `<DTPOSTED>` (date portion only, UTC). */
  readonly postedAt: number
  /** Signed minor units (cents for two-decimal currencies), from `<TRNAMT>`. */
  readonly amountMinor: bigint
  /** From `<NAME>` or `<PAYEE><NAME>`. May be empty. */
  readonly payee: string
  readonly memo: string | null
  readonly checkNumber: string | null
  /** `<TRNTYPE>` — DEBIT / CREDIT / CHECK / DEP / ATM / etc. */
  readonly type: string | null
}

export interface OfxStatement {
  readonly account: OfxAccount
  readonly transactions: readonly OfxTransaction[]
}

export interface OfxParseResult {
  readonly statements: readonly OfxStatement[]
  /** Number of `<INVSTMTRS>` sections found and skipped (M6 work). */
  readonly investmentStatementCount: number
  readonly warnings: readonly string[]
}

/** Stable, namespaced key used to remember which Worth account an OFX source maps to. */
export const externalAccountKey = (a: OfxAccount): string =>
  `ofx:${a.institutionId ?? "unknown"}:${a.accountId}`

// -- Top-level parser -------------------------------------------------------

export const parseOfx = (text: string): OfxParseResult => {
  const warnings: string[] = []
  const trimmed = text.replace(/^\uFEFF/, "").trimStart()
  if (trimmed === "") {
    return { statements: [], investmentStatementCount: 0, warnings: ["Empty OFX file"] }
  }

  const body = stripHeader(trimmed)
  const xml = isXmlBody(body) ? body : sgmlToXml(body)

  // Bank statements: <STMTRS> inside <BANKMSGSRSV1>.
  const bankStatements = extractBlocks(xml, "STMTRS")
  // Credit-card statements: <CCSTMTRS> inside <CREDITCARDMSGSRSV1>.
  const ccStatements = extractBlocks(xml, "CCSTMTRS")
  // Investment statements: <INVSTMTRS> inside <INVSTMTMSGSRSV1>. Counted, not parsed.
  const invStatements = extractBlocks(xml, "INVSTMTRS")

  const statements: OfxStatement[] = []

  for (const block of [...bankStatements, ...ccStatements]) {
    const account = extractAccount(block)
    if (!account) {
      warnings.push("Statement missing account identification, skipped")
      continue
    }
    const transactions = extractTransactions(block, warnings)
    statements.push({ account, transactions })
  }

  if (invStatements.length > 0) {
    warnings.push(
      `Skipped ${invStatements.length} investment statement(s) — investment import lands in M6`,
    )
  }

  if (statements.length === 0 && invStatements.length === 0) {
    warnings.push("No bank, credit card, or investment statements found in file")
  }

  return {
    statements,
    investmentStatementCount: invStatements.length,
    warnings,
  }
}

// -- Header / format detection ---------------------------------------------

const stripHeader = (text: string): string => {
  // OFX 2.x: optional `<?xml ...?>` then `<?OFX ...?>` then `<OFX>`.
  if (text.startsWith("<?xml")) {
    const end = text.indexOf("?>", 5)
    if (end !== -1) text = text.slice(end + 2).trimStart()
  }
  if (text.startsWith("<?OFX")) {
    const end = text.indexOf("?>", 5)
    if (end !== -1) text = text.slice(end + 2).trimStart()
  }
  // OFX 1.x: lines like `OFXHEADER:100`, `DATA:OFXSGML`, ... blank line, then `<OFX>`.
  if (/^OFXHEADER\s*:/m.test(text)) {
    const idx = text.indexOf("<OFX>")
    if (idx !== -1) text = text.slice(idx)
  }
  return text
}

const isXmlBody = (body: string): boolean => {
  // Heuristic: every leaf <TAG>value is followed by a matching </TAG>.
  // We test by checking whether the first leaf-looking tag has a closer.
  const m = body.match(/<([A-Z0-9.]+)>([^<\r\n]+)/)
  if (!m) return true
  return body.includes(`</${m[1]}>`)
}

// -- SGML → XML normalization ----------------------------------------------

/**
 * OFX 1.x uses SGML where leaf elements have no closing tag:
 *
 *   <DTPOSTED>20240115
 *   <TRNAMT>-12.50
 *
 * Auto-close any leaf `<TAG>value` whose following non-whitespace is text
 * rather than another tag. Block tags (whose immediate next non-whitespace
 * character is `<`) are passed through untouched and stay well-formed.
 */
const sgmlToXml = (body: string): string => {
  const parts = body.split(/(<\/?[A-Z0-9.]+>)/i)
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i] ?? ""
    const open = tok.match(/^<([A-Z0-9.]+)>$/)
    if (!open) {
      out.push(tok)
      continue
    }
    const next = parts[i + 1] ?? ""
    const trimmed = next.replace(/^\s+|\s+$/g, "")
    if (trimmed === "") {
      // Block tag: pass through. The whitespace token gets emitted next iteration.
      out.push(tok)
      continue
    }
    // Leaf node: emit `<TAG>value</TAG>` and preserve any trailing whitespace
    // so the next tag remains visually separated.
    const trailing = next.match(/\s*$/)?.[0] ?? ""
    out.push(`<${open[1]}>${escapeXml(trimmed)}</${open[1]}>${trailing}`)
    i++
  }
  return out.join("")
}

const escapeXml = (s: string): string =>
  s.replace(/&(?!(amp|lt|gt|apos|quot);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// -- Block extraction -------------------------------------------------------

/**
 * Find every `<TAG>...</TAG>` block in `xml`. Returns inner content of each
 * occurrence. Tag names are case-insensitive (institutions vary).
 */
const extractBlocks = (xml: string, tag: string): string[] => {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi")
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) out.push(m[1])
  }
  return out
}

const tagText = (xml: string, tag: string): string | null => {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i")
  const m = xml.match(re)
  if (!m || m[1] === undefined) return null
  return decodeXml(m[1].trim())
}

const decodeXml = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')

// -- Account / transaction extraction --------------------------------------

const extractAccount = (statementXml: string): OfxAccount | null => {
  // Bank: <BANKACCTFROM>{<BANKID>, <ACCTID>, <ACCTTYPE>}.
  // CC:   <CCACCTFROM>{<ACCTID>}.
  const acctBlock =
    extractBlocks(statementXml, "BANKACCTFROM")[0] ??
    extractBlocks(statementXml, "CCACCTFROM")[0] ??
    null
  if (acctBlock === null) return null
  const accountId = tagText(acctBlock, "ACCTID")
  if (!accountId) return null
  return {
    institutionId: tagText(acctBlock, "BANKID"),
    accountId,
    accountType: tagText(acctBlock, "ACCTTYPE"),
    currency: tagText(statementXml, "CURDEF"),
  }
}

const extractTransactions = (statementXml: string, warnings: string[]): OfxTransaction[] => {
  const tranListBlock = extractBlocks(statementXml, "BANKTRANLIST")[0]
  if (tranListBlock === undefined) return []
  const stmtTxns = extractBlocks(tranListBlock, "STMTTRN")
  const txns: OfxTransaction[] = []
  for (const block of stmtTxns) {
    const fitid = tagText(block, "FITID")
    const dt = tagText(block, "DTPOSTED")
    const amt = tagText(block, "TRNAMT")
    if (!fitid || !dt || amt === null) {
      warnings.push("Transaction missing FITID/DTPOSTED/TRNAMT, skipped")
      continue
    }
    const postedAt = parseOfxDate(dt)
    const amountMinor = parseAmount(amt)
    if (postedAt === null || amountMinor === null) {
      warnings.push(`Unparseable date/amount for FITID ${fitid}, skipped`)
      continue
    }
    // Prefer <PAYEE><NAME> when present; fall back to flat <NAME>.
    const payeeBlock = extractBlocks(block, "PAYEE")[0]
    const payee = (payeeBlock && tagText(payeeBlock, "NAME")) ?? tagText(block, "NAME") ?? ""
    txns.push({
      fitid,
      postedAt,
      amountMinor,
      payee,
      memo: tagText(block, "MEMO"),
      checkNumber: tagText(block, "CHECKNUM"),
      type: tagText(block, "TRNTYPE"),
    })
  }
  return txns
}

/**
 * `<DTPOSTED>` is `YYYYMMDDHHMMSS[.SSS][TZ]`. We honor only the date portion
 * and treat it as UTC midnight — banks vary on the time component, and Worth
 * stores `posted_at` as a calendar-day-anchored timestamp.
 */
const parseOfxDate = (raw: string): number | null => {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return null
  return Date.UTC(year, month - 1, day)
}
