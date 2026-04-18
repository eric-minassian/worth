import { QUANTITY_SCALE } from "@worth/domain"
import { parseAmount, parseQuantity } from "./money"

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

// -- Investment types -------------------------------------------------------

export interface OfxInvAccount {
  /** `<BROKERID>` — brokerage domain/id. */
  readonly brokerId: string | null
  /** `<ACCTID>` — brokerage account number. */
  readonly accountId: string
  /** `<CURDEF>` — statement currency. */
  readonly currency: string | null
}

/** `<SECID><UNIQUEID>` + `<UNIQUEIDTYPE>` — CUSIP or TICKER typically. */
export interface OfxSecId {
  readonly uniqueId: string
  readonly uniqueIdType: string
}

export type OfxSecurityKind = "stock" | "mutual_fund" | "bond" | "other"

export interface OfxSecurity {
  readonly secId: OfxSecId
  readonly name: string
  readonly ticker: string | null
  readonly kind: OfxSecurityKind
  readonly currency: string | null
}

export type OfxInvTransaction =
  | OfxInvTradeTransaction
  | OfxInvIncomeTransaction
  | OfxInvReinvestTransaction
  | OfxInvCashTransaction

/**
 * `<INVBANKTRAN>` — a cash-only movement inside an investment account.
 * Signed: positive = credit (deposit/interest), negative = debit
 * (withdrawal/fee). `trnType` is the OFX `<TRNTYPE>` value so downstream
 * classifiers can map to a richer cash-flow kind (DIV, INT, FEE, XFER, …).
 */
export interface OfxInvCashTransaction {
  readonly kind: "cash"
  readonly fitid: string
  readonly tradeDate: number
  readonly amountMinor: bigint
  readonly memo: string | null
  readonly trnType: string | null
}

export interface OfxInvTradeTransaction {
  readonly kind: "buy" | "sell"
  readonly fitid: string
  /** `<DTTRADE>` — trade date (ms UTC at day boundary). */
  readonly tradeDate: number
  readonly secId: OfxSecId
  /** Fractional shares at 1e-8 micro-units. Positive (direction comes from kind). */
  readonly units: bigint
  /** Per-share price in minor units. */
  readonly unitPriceMinor: bigint
  /** Commissions + fees combined, non-negative minor units. */
  readonly feesMinor: bigint
  /** Signed cash impact from `<TOTAL>` (negative for buy, positive for sell). */
  readonly totalMinor: bigint
}

export interface OfxInvIncomeTransaction {
  readonly kind: "dividend"
  readonly fitid: string
  readonly tradeDate: number
  readonly secId: OfxSecId
  readonly totalMinor: bigint
  /** `<INCOMETYPE>` — DIV, INTEREST, CGLONG, CGSHORT, MISC. */
  readonly incomeType: string | null
}

/**
 * `<REINVDIV>` / `<REINVEST>` / `<REINVCG>` — a dividend/capital gain that
 * was automatically reinvested into the same security. Semantically a
 * dividend + buy in one transaction. Downstream (ImportService) expands it
 * into a Dividend event + Buy event so cost basis + income stay correct.
 */
export interface OfxInvReinvestTransaction {
  readonly kind: "reinvest"
  readonly fitid: string
  readonly tradeDate: number
  readonly secId: OfxSecId
  /** Shares purchased (positive, micro-units). */
  readonly units: bigint
  readonly unitPriceMinor: bigint
  readonly feesMinor: bigint
  /** Absolute cash value of the reinvested distribution — positive. */
  readonly totalMinor: bigint
  /** DIV | INTEREST | CGLONG | CGSHORT | MISC — null if not specified. */
  readonly incomeType: string | null
}

export interface OfxInvStatement {
  readonly account: OfxInvAccount
  readonly transactions: readonly OfxInvTransaction[]
}

export interface OfxParseResult {
  readonly statements: readonly OfxStatement[]
  readonly investmentStatements: readonly OfxInvStatement[]
  readonly securities: readonly OfxSecurity[]
  /** Kept for backward compat — equals `investmentStatements.length`. */
  readonly investmentStatementCount: number
  readonly warnings: readonly string[]
}

/** Stable, namespaced key used to remember which Worth account an OFX source maps to. */
export const externalAccountKey = (a: OfxAccount): string =>
  `ofx:${a.institutionId ?? "unknown"}:${a.accountId}`

/** Same shape as {@link externalAccountKey} but namespaced for investment sources. */
export const externalInvestmentAccountKey = (a: OfxInvAccount): string =>
  `ofx-inv:${a.brokerId ?? "unknown"}:${a.accountId}`

// -- Top-level parser -------------------------------------------------------

export const parseOfx = (text: string): OfxParseResult => {
  const warnings: string[] = []
  const trimmed = text.replace(/^\uFEFF/, "").trimStart()
  if (trimmed === "") {
    return {
      statements: [],
      investmentStatements: [],
      securities: [],
      investmentStatementCount: 0,
      warnings: ["Empty OFX file"],
    }
  }

  const body = stripHeader(trimmed)
  const xml = isXmlBody(body) ? body : sgmlToXml(body)

  // Bank statements: <STMTRS> inside <BANKMSGSRSV1>.
  const bankStatements = extractBlocks(xml, "STMTRS")
  // Credit-card statements: <CCSTMTRS> inside <CREDITCARDMSGSRSV1>.
  const ccStatements = extractBlocks(xml, "CCSTMTRS")
  // Investment statements: <INVSTMTRS> inside <INVSTMTMSGSRSV1>.
  const invStatementBlocks = extractBlocks(xml, "INVSTMTRS")

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

  // <SECLIST> appears at OFX root (not nested in a statement). Parse once so
  // every investment statement can resolve its secId → name/ticker/kind.
  const securities = extractSecurities(xml, warnings)

  const investmentStatements: OfxInvStatement[] = []
  for (const block of invStatementBlocks) {
    const account = extractInvAccount(block)
    if (!account) {
      warnings.push("Investment statement missing account identification, skipped")
      continue
    }
    const transactions = extractInvTransactions(block, warnings)
    investmentStatements.push({ account, transactions })
  }

  if (
    statements.length === 0 &&
    investmentStatements.length === 0 &&
    securities.length === 0
  ) {
    warnings.push("No bank, credit card, or investment statements found in file")
  }

  return {
    statements,
    investmentStatements,
    securities,
    investmentStatementCount: investmentStatements.length,
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

// -- Investment extraction --------------------------------------------------

const SECURITY_KIND_TAG: Record<string, OfxSecurityKind> = {
  STOCKINFO: "stock",
  MFINFO: "mutual_fund",
  DEBTINFO: "bond",
  OTHERINFO: "other",
  OPTINFO: "other",
}

const extractSecurities = (xml: string, warnings: string[]): OfxSecurity[] => {
  const listBlock = extractBlocks(xml, "SECLIST")[0]
  if (listBlock === undefined) return []
  const out: OfxSecurity[] = []
  for (const [tag, kind] of Object.entries(SECURITY_KIND_TAG)) {
    for (const wrapper of extractBlocks(listBlock, tag)) {
      const info = extractBlocks(wrapper, "SECINFO")[0] ?? wrapper
      const secId = extractSecId(info)
      if (!secId) {
        warnings.push(`Security in <${tag}> missing <SECID>, skipped`)
        continue
      }
      const name = tagText(info, "SECNAME") ?? secId.uniqueId
      out.push({
        secId,
        name,
        ticker: tagText(info, "TICKER"),
        kind,
        currency: tagText(info, "CURDEF"),
      })
    }
  }
  return out
}

const extractSecId = (xml: string): OfxSecId | null => {
  const block = extractBlocks(xml, "SECID")[0]
  if (block === undefined) return null
  const uniqueId = tagText(block, "UNIQUEID")
  const uniqueIdType = tagText(block, "UNIQUEIDTYPE")
  if (!uniqueId || !uniqueIdType) return null
  return { uniqueId, uniqueIdType }
}

const extractInvAccount = (statementXml: string): OfxInvAccount | null => {
  const block = extractBlocks(statementXml, "INVACCTFROM")[0]
  if (block === undefined) return null
  const accountId = tagText(block, "ACCTID")
  if (!accountId) return null
  return {
    brokerId: tagText(block, "BROKERID"),
    accountId,
    currency: tagText(statementXml, "CURDEF"),
  }
}

const BUY_TAGS = ["BUYSTOCK", "BUYMF", "BUYOTHER", "BUYDEBT"] as const
const SELL_TAGS = ["SELLSTOCK", "SELLMF", "SELLOTHER", "SELLDEBT"] as const
const REINVEST_TAGS = ["REINVEST", "REINVDIV", "REINVCG"] as const

const extractInvTransactions = (
  statementXml: string,
  warnings: string[],
): OfxInvTransaction[] => {
  const tranList = extractBlocks(statementXml, "INVTRANLIST")[0]
  if (tranList === undefined) return []
  const txns: OfxInvTransaction[] = []

  for (const outerTag of BUY_TAGS) {
    for (const outer of extractBlocks(tranList, outerTag)) {
      // <BUYSTOCK><INVBUY>...</INVBUY>...</BUYSTOCK>
      const inner = extractBlocks(outer, "INVBUY")[0] ?? outer
      const t = parseTradeInvTransaction("buy", inner, warnings)
      if (t) txns.push(t)
    }
  }
  for (const outerTag of SELL_TAGS) {
    for (const outer of extractBlocks(tranList, outerTag)) {
      const inner = extractBlocks(outer, "INVSELL")[0] ?? outer
      const t = parseTradeInvTransaction("sell", inner, warnings)
      if (t) txns.push(t)
    }
  }
  for (const block of extractBlocks(tranList, "INCOME")) {
    const t = parseIncomeInvTransaction(block, warnings)
    if (t) txns.push(t)
  }
  for (const outerTag of REINVEST_TAGS) {
    for (const block of extractBlocks(tranList, outerTag)) {
      const t = parseReinvestInvTransaction(block, warnings)
      if (t) txns.push(t)
    }
  }

  for (const block of extractBlocks(tranList, "INVBANKTRAN")) {
    const t = parseInvBankTran(block, warnings)
    if (t) txns.push(t)
  }

  return txns
}

const parseInvBankTran = (
  block: string,
  warnings: string[],
): OfxInvCashTransaction | null => {
  // <INVBANKTRAN> wraps a <STMTTRN> (same shape as banking transactions)
  // plus a <SUBACCTFUND>. We only care about the STMTTRN payload.
  const stmtTxn = extractBlocks(block, "STMTTRN")[0] ?? block
  const fitid = tagText(stmtTxn, "FITID")
  const dt = tagText(stmtTxn, "DTPOSTED") ?? tagText(stmtTxn, "DTTRADE")
  const amt = tagText(stmtTxn, "TRNAMT")
  if (!fitid || !dt || amt === null) {
    warnings.push("INVBANKTRAN missing FITID/DTPOSTED/TRNAMT, skipped")
    return null
  }
  const tradeDate = parseOfxDate(dt)
  const amountMinor = parseAmount(amt)
  if (tradeDate === null || amountMinor === null) {
    warnings.push(`Unparseable INVBANKTRAN fields for FITID ${fitid}, skipped`)
    return null
  }
  const payeeBlock = extractBlocks(stmtTxn, "PAYEE")[0]
  const payee =
    (payeeBlock && tagText(payeeBlock, "NAME")) ?? tagText(stmtTxn, "NAME") ?? null
  const memoText = tagText(stmtTxn, "MEMO")
  const memo =
    payee && memoText ? `${payee} — ${memoText}` : payee ?? memoText ?? null
  return {
    kind: "cash",
    fitid,
    tradeDate,
    amountMinor,
    memo,
    trnType: tagText(stmtTxn, "TRNTYPE"),
  }
}

const parseTradeInvTransaction = (
  kind: "buy" | "sell",
  inner: string,
  warnings: string[],
): OfxInvTradeTransaction | null => {
  const tranBlock = extractBlocks(inner, "INVTRAN")[0] ?? inner
  const fitid = tagText(tranBlock, "FITID")
  const dt = tagText(tranBlock, "DTTRADE") ?? tagText(tranBlock, "DTSETTLE")
  const secId = extractSecId(inner)
  const unitsRaw = tagText(inner, "UNITS")
  const unitPriceRaw = tagText(inner, "UNITPRICE")
  const totalRaw = tagText(inner, "TOTAL")
  if (!fitid || !dt || !secId || unitsRaw === null || unitPriceRaw === null) {
    warnings.push("Investment trade missing FITID/DTTRADE/SECID/UNITS/UNITPRICE, skipped")
    return null
  }
  const tradeDate = parseOfxDate(dt)
  const unitsSigned = parseQuantity(unitsRaw)
  const unitPriceMinor = parseAmount(unitPriceRaw)
  if (tradeDate === null || unitsSigned === null || unitPriceMinor === null) {
    warnings.push(`Unparseable trade fields for FITID ${fitid}, skipped`)
    return null
  }
  // OFX sometimes signs UNITS negative on sells; we surface direction via
  // `kind` instead, so work with the absolute value downstream.
  const units = unitsSigned < 0n ? -unitsSigned : unitsSigned
  const commissions = parseAmount(tagText(inner, "COMMISSION") ?? "0") ?? 0n
  const otherFees = parseAmount(tagText(inner, "FEES") ?? "0") ?? 0n
  const feesMinor =
    (commissions < 0n ? -commissions : commissions) +
    (otherFees < 0n ? -otherFees : otherFees)
  const totalMinor =
    totalRaw !== null ? (parseAmount(totalRaw) ?? 0n) : fallbackTotal(kind, units, unitPriceMinor, feesMinor)
  return { kind, fitid, tradeDate, secId, units, unitPriceMinor, feesMinor, totalMinor }
}

const parseReinvestInvTransaction = (
  block: string,
  warnings: string[],
): OfxInvReinvestTransaction | null => {
  const tranBlock = extractBlocks(block, "INVTRAN")[0] ?? block
  const fitid = tagText(tranBlock, "FITID")
  const dt = tagText(tranBlock, "DTTRADE") ?? tagText(tranBlock, "DTSETTLE")
  const secId = extractSecId(block)
  const unitsRaw = tagText(block, "UNITS")
  const unitPriceRaw = tagText(block, "UNITPRICE")
  const totalRaw = tagText(block, "TOTAL")
  if (!fitid || !dt || !secId || unitsRaw === null || unitPriceRaw === null) {
    warnings.push(
      "Reinvest missing FITID/DTTRADE/SECID/UNITS/UNITPRICE, skipped",
    )
    return null
  }
  const tradeDate = parseOfxDate(dt)
  const unitsSigned = parseQuantity(unitsRaw)
  const unitPriceMinor = parseAmount(unitPriceRaw)
  if (tradeDate === null || unitsSigned === null || unitPriceMinor === null) {
    warnings.push(`Unparseable reinvest fields for FITID ${fitid}, skipped`)
    return null
  }
  const units = unitsSigned < 0n ? -unitsSigned : unitsSigned
  const commissions = parseAmount(tagText(block, "COMMISSION") ?? "0") ?? 0n
  const otherFees = parseAmount(tagText(block, "FEES") ?? "0") ?? 0n
  const feesMinor =
    (commissions < 0n ? -commissions : commissions) +
    (otherFees < 0n ? -otherFees : otherFees)
  // TOTAL is typically negative (cash "paid" for the reinvested shares).
  // We surface the absolute value since the dividend-amount semantics read
  // more naturally as a positive distribution.
  const totalRawMinor =
    totalRaw !== null
      ? parseAmount(totalRaw) ?? 0n
      : (units * unitPriceMinor) / QUANTITY_SCALE
  const totalMinor = totalRawMinor < 0n ? -totalRawMinor : totalRawMinor
  return {
    kind: "reinvest",
    fitid,
    tradeDate,
    secId,
    units,
    unitPriceMinor,
    feesMinor,
    totalMinor,
    incomeType: tagText(block, "INCOMETYPE"),
  }
}

const parseIncomeInvTransaction = (
  block: string,
  warnings: string[],
): OfxInvIncomeTransaction | null => {
  const tranBlock = extractBlocks(block, "INVTRAN")[0] ?? block
  const fitid = tagText(tranBlock, "FITID")
  const dt = tagText(tranBlock, "DTTRADE") ?? tagText(tranBlock, "DTSETTLE")
  const secId = extractSecId(block)
  const totalRaw = tagText(block, "TOTAL")
  if (!fitid || !dt || !secId || totalRaw === null) {
    warnings.push("Investment income missing FITID/DTTRADE/SECID/TOTAL, skipped")
    return null
  }
  const tradeDate = parseOfxDate(dt)
  const totalMinor = parseAmount(totalRaw)
  if (tradeDate === null || totalMinor === null) {
    warnings.push(`Unparseable income fields for FITID ${fitid}, skipped`)
    return null
  }
  return {
    kind: "dividend",
    fitid,
    tradeDate,
    secId,
    totalMinor,
    incomeType: tagText(block, "INCOMETYPE"),
  }
}

/**
 * If `<TOTAL>` is absent, approximate cash impact from the components. Sign
 * convention matches OFX: negative for buys, positive for sells. Callers
 * overwrite with the exact TOTAL whenever the institution provides one.
 */
const fallbackTotal = (
  kind: "buy" | "sell",
  units: bigint,
  unitPriceMinor: bigint,
  feesMinor: bigint,
): bigint => {
  const gross = (units * unitPriceMinor) / QUANTITY_SCALE
  return kind === "buy" ? -(gross + feesMinor) : gross - feesMinor
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
