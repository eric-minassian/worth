import { describe, expect, it } from "vitest"
import {
  externalAccountKey,
  externalInvestmentAccountKey,
  parseOfx,
  parseQuantity,
} from "../src"

// -- Fixtures (inline) ------------------------------------------------------

/** OFX 1.x SGML — typical Bank of America style download. */
const OFX1_BANK = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>0
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>026009593
<ACCTID>1234567890
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131000000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115120000
<TRNAMT>-12.50
<FITID>2024011500001
<NAME>WHOLE FOODS #123
<MEMO>groceries
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240117000000
<TRNAMT>2500.00
<FITID>2024011700002
<NAME>EMPLOYER PAYROLL
</STMTTRN>
<STMTTRN>
<TRNTYPE>CHECK
<DTPOSTED>20240120000000
<TRNAMT>-150.00
<FITID>2024012000003
<CHECKNUM>1234
<NAME>RENT
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2337.50
<DTASOF>20240131000000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

/** OFX 2.x XML — credit card statement. */
const OFX2_CREDITCARD = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="200" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>1</TRNUID>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <CCSTMTRS>
        <CURDEF>USD</CURDEF>
        <CCACCTFROM>
          <ACCTID>4111111111111111</ACCTID>
        </CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20240201000000</DTSTART>
          <DTEND>20240228000000</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20240210000000</DTPOSTED>
            <TRNAMT>-89.99</TRNAMT>
            <FITID>AMEX-2024021000A</FITID>
            <NAME>AMAZON.COM</NAME>
            <MEMO>Order #123-456</MEMO>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20240215000000</DTPOSTED>
            <TRNAMT>89.99</TRNAMT>
            <FITID>AMEX-2024021500B</FITID>
            <NAME>AMAZON.COM REFUND</NAME>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`

/** Investment-only OFX — should be detected, counted, and skipped (M6). */
const OFX_INVESTMENT_ONLY = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>0
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<INVSTMTRS>
<DTASOF>20240131000000
<CURDEF>USD
<INVACCTFROM>
<BROKERID>fidelity.com
<ACCTID>Z12345678
</INVACCTFROM>
<INVTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131000000
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`

/** Uses <PAYEE><NAME> rather than the flat <NAME>. */
const OFX1_NESTED_PAYEE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123
<ACCTID>9999
<ACCTTYPE>SAVINGS
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240301000000
<TRNAMT>(45.67)
<FITID>NESTED-1
<PAYEE>
<NAME>Vendor Co
<ADDR1>1 Test St
<CITY>Townsville
<STATE>CA
<POSTALCODE>90000
</PAYEE>
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

// -- Tests ------------------------------------------------------------------

describe("parseOfx — OFX 1.x SGML bank statement", () => {
  const result = parseOfx(OFX1_BANK)

  it("extracts a single bank statement", () => {
    expect(result.statements).toHaveLength(1)
    expect(result.investmentStatementCount).toBe(0)
  })

  it("captures account identification", () => {
    const acct = result.statements[0]?.account
    expect(acct).toEqual({
      institutionId: "026009593",
      accountId: "1234567890",
      accountType: "CHECKING",
      currency: "USD",
    })
  })

  it("parses transactions with FITID, signed amount, ISO date", () => {
    const txns = result.statements[0]?.transactions ?? []
    expect(txns).toHaveLength(3)
    expect(txns[0]).toMatchObject({
      fitid: "2024011500001",
      amountMinor: -1250n,
      payee: "WHOLE FOODS #123",
      memo: "groceries",
      type: "DEBIT",
    })
    expect(txns[1]).toMatchObject({
      fitid: "2024011700002",
      amountMinor: 250000n,
      payee: "EMPLOYER PAYROLL",
      type: "CREDIT",
    })
    expect(txns[2]).toMatchObject({
      fitid: "2024012000003",
      amountMinor: -15000n,
      checkNumber: "1234",
      type: "CHECK",
    })
  })

  it("anchors postedAt at UTC midnight", () => {
    const t = result.statements[0]?.transactions[0]
    expect(t?.postedAt).toBe(Date.UTC(2024, 0, 15))
  })
})

describe("parseOfx — OFX 2.x XML credit card statement", () => {
  const result = parseOfx(OFX2_CREDITCARD)

  it("extracts a single credit card statement (CCSTMTRS)", () => {
    expect(result.statements).toHaveLength(1)
  })

  it("populates institutionId as null for credit cards", () => {
    expect(result.statements[0]?.account.institutionId).toBeNull()
    expect(result.statements[0]?.account.accountId).toBe("4111111111111111")
  })

  it("parses both debit and credit", () => {
    const txns = result.statements[0]?.transactions ?? []
    expect(txns).toHaveLength(2)
    expect(txns[0]?.amountMinor).toBe(-8999n)
    expect(txns[1]?.amountMinor).toBe(8999n)
  })
})

describe("parseOfx — investment-only file", () => {
  const result = parseOfx(OFX_INVESTMENT_ONLY)

  it("returns no bank statements", () => {
    expect(result.statements).toHaveLength(0)
  })

  it("extracts the investment statement (even if empty)", () => {
    expect(result.investmentStatementCount).toBe(1)
    expect(result.investmentStatements[0]?.account.brokerId).toBe("fidelity.com")
  })
})

describe("parseOfx — <PAYEE><NAME> nested form", () => {
  const result = parseOfx(OFX1_NESTED_PAYEE)

  it("extracts nested payee name", () => {
    const t = result.statements[0]?.transactions[0]
    expect(t?.payee).toBe("Vendor Co")
  })

  it("handles parenthesized negative amount", () => {
    const t = result.statements[0]?.transactions[0]
    expect(t?.amountMinor).toBe(-4567n)
  })
})

describe("parseOfx — robustness", () => {
  it("returns empty result for empty input", () => {
    const result = parseOfx("")
    expect(result.statements).toHaveLength(0)
    expect(result.investmentStatementCount).toBe(0)
    expect(result.warnings).toContain("Empty OFX file")
  })

  it("warns when no recognizable statements are present", () => {
    const result = parseOfx("<OFX></OFX>")
    expect(result.statements).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it("skips transactions missing FITID/DTPOSTED/TRNAMT", () => {
    const broken = OFX1_BANK.replace("<FITID>2024011500001\n", "")
    const result = parseOfx(broken)
    const txns = result.statements[0]?.transactions ?? []
    expect(txns).toHaveLength(2)
    expect(result.warnings.some((w) => /missing/i.test(w))).toBe(true)
  })
})

// OFX 1.x brokerage statement with buy, sell, dividend, plus a SECLIST.
const OFX1_BROKERAGE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>0
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<INVSTMTRS>
<DTASOF>20240131000000
<CURDEF>USD
<INVACCTFROM>
<BROKERID>fidelity.com
<ACCTID>Z12345678
</INVACCTFROM>
<INVTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131000000
<BUYSTOCK>
<INVBUY>
<INVTRAN>
<FITID>BUY-20240105-001
<DTTRADE>20240105000000
</INVTRAN>
<SECID>
<UNIQUEID>922908363
<UNIQUEIDTYPE>CUSIP
</SECID>
<UNITS>10
<UNITPRICE>200.00
<COMMISSION>0
<FEES>0
<TOTAL>-2000.00
</INVBUY>
<BUYTYPE>BUY
</BUYSTOCK>
<SELLSTOCK>
<INVSELL>
<INVTRAN>
<FITID>SELL-20240120-002
<DTTRADE>20240120000000
</INVTRAN>
<SECID>
<UNIQUEID>922908363
<UNIQUEIDTYPE>CUSIP
</SECID>
<UNITS>4
<UNITPRICE>250.00
<COMMISSION>1.00
<FEES>0
<TOTAL>999.00
</INVSELL>
<SELLTYPE>SELL
</SELLSTOCK>
<INCOME>
<INVTRAN>
<FITID>DIV-20240125-003
<DTTRADE>20240125000000
</INVTRAN>
<SECID>
<UNIQUEID>922908363
<UNIQUEIDTYPE>CUSIP
</SECID>
<INCOMETYPE>DIV
<TOTAL>12.50
</INCOME>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1>
<SECLIST>
<STOCKINFO>
<SECINFO>
<SECID>
<UNIQUEID>922908363
<UNIQUEIDTYPE>CUSIP
</SECID>
<SECNAME>Vanguard Total Stock Market ETF
<TICKER>VTI
</SECINFO>
</STOCKINFO>
</SECLIST>
</SECLISTMSGSRSV1>
</OFX>`

describe("parseOfx — brokerage statement with buy/sell/dividend", () => {
  const result = parseOfx(OFX1_BROKERAGE)

  it("extracts the security with ticker + name", () => {
    expect(result.securities).toHaveLength(1)
    expect(result.securities[0]).toMatchObject({
      secId: { uniqueId: "922908363", uniqueIdType: "CUSIP" },
      ticker: "VTI",
      name: "Vanguard Total Stock Market ETF",
      kind: "stock",
    })
  })

  it("extracts the investment account", () => {
    expect(result.investmentStatements).toHaveLength(1)
    expect(result.investmentStatements[0]?.account).toEqual({
      brokerId: "fidelity.com",
      accountId: "Z12345678",
      currency: "USD",
    })
  })

  it("parses buy/sell/dividend transactions with correct signs and magnitudes", () => {
    const txns = result.investmentStatements[0]?.transactions ?? []
    expect(txns).toHaveLength(3)

    const [buy, sell, div] = txns
    expect(buy).toMatchObject({
      kind: "buy",
      fitid: "BUY-20240105-001",
      units: BigInt(10 * 1e8),
      unitPriceMinor: 20000n,
      feesMinor: 0n,
      totalMinor: -200000n,
    })
    expect(sell).toMatchObject({
      kind: "sell",
      fitid: "SELL-20240120-002",
      units: BigInt(4 * 1e8),
      unitPriceMinor: 25000n,
      feesMinor: 100n,
      totalMinor: 99900n,
    })
    expect(div).toMatchObject({
      kind: "dividend",
      fitid: "DIV-20240125-003",
      totalMinor: 1250n,
      incomeType: "DIV",
    })
  })
})

// Vanguard-style QFX: BUYMF with 5-decimal UNITPRICE, REINVDIV + REINVEST,
// INVBANKTRAN (cash movement) that should be skipped with a warning.
const VANGUARD_QFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>0
<INVSTMTRS>
<DTASOF>20250101000000.000[-5:EST]
<CURDEF>USD
<INVACCTFROM>
<BROKERID>vanguard.com
<ACCTID>57096170
</INVACCTFROM>
<INVTRANLIST>
<DTSTART>20240101000000.000[-5:EST]
<DTEND>20250101000000.000[-5:EST]
<BUYMF>
<INVBUY>
<INVTRAN>
<FITID>VG-BUY-1
<DTTRADE>20241025160000.000[-5:EST]
<DTSETTLE>20241028160000.000[-5:EST]
</INVTRAN>
<SECID>
<UNIQUEID>922908728
<UNIQUEIDTYPE>CUSIP
</SECID>
<UNITS>126.277
<UNITPRICE>138.98018
<TOTAL>-17550.0
</INVBUY>
<BUYTYPE>BUY
</BUYMF>
<REINVDIV>
<INVTRAN>
<FITID>VG-REINV-1
<DTTRADE>20241031160000.000[-5:EST]
</INVTRAN>
<SECID>
<UNIQUEID>922908728
<UNIQUEIDTYPE>CUSIP
</SECID>
<INCOMETYPE>DIV
<TOTAL>-9.24
<UNITS>0.955
<UNITPRICE>9.68
</REINVDIV>
<INVBANKTRAN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20241101000000
<TRNAMT>500.00
<FITID>VG-CASH-1
<NAME>ELECTRONIC TRANSFER
</STMTTRN>
<SUBACCTFUND>CASH
</INVBANKTRAN>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1>
<SECLIST>
<MFINFO>
<SECINFO>
<SECID>
<UNIQUEID>922908728
<UNIQUEIDTYPE>CUSIP
</SECID>
<SECNAME>Vanguard Total Bond Market Index Admiral
<TICKER>VBTLX
</SECINFO>
</MFINFO>
</SECLIST>
</SECLISTMSGSRSV1>
</OFX>`

describe("parseOfx — Vanguard-style QFX", () => {
  const result = parseOfx(VANGUARD_QFX)

  it("extracts a mutual fund from SECLIST (MFINFO → mutual_fund)", () => {
    expect(result.securities).toHaveLength(1)
    expect(result.securities[0]).toMatchObject({
      ticker: "VBTLX",
      kind: "mutual_fund",
    })
  })

  it("parses a 5-decimal UNITPRICE losslessly-enough (truncated to cents)", () => {
    const buy = result.investmentStatements[0]?.transactions.find(
      (t) => t.fitid === "VG-BUY-1",
    )
    expect(buy?.kind).toBe("buy")
    // 126.277 × 1e8 = 12_627_700_000 micro-units
    expect(buy && "units" in buy ? buy.units : null).toBe(12_627_700_000n)
    // 138.98018 truncated to 2 decimals = 13898 cents
    expect(buy && "unitPriceMinor" in buy ? buy.unitPriceMinor : null).toBe(
      13898n,
    )
    expect(buy && "totalMinor" in buy ? buy.totalMinor : null).toBe(-1_755_000n)
  })

  it("captures REINVDIV as a reinvest-kind transaction with positive totalMinor", () => {
    const re = result.investmentStatements[0]?.transactions.find(
      (t) => t.fitid === "VG-REINV-1",
    )
    expect(re?.kind).toBe("reinvest")
    expect(re && "units" in re ? re.units : null).toBe(95_500_000n)
    // Absolute value — the sign on cash-flow is recovered at commit time.
    expect(re && "totalMinor" in re ? re.totalMinor : null).toBe(924n)
    expect(
      re && "incomeType" in re ? re.incomeType : null,
    ).toBe("DIV")
  })

  it("emits INVBANKTRAN as a cash-kind transaction with preserved sign + memo", () => {
    const txns = result.investmentStatements[0]?.transactions ?? []
    const cash = txns.find((t) => t.fitid === "VG-CASH-1")
    expect(cash?.kind).toBe("cash")
    // <TRNAMT>500.00 → +50000 cents (credit).
    expect(cash && "amountMinor" in cash ? cash.amountMinor : null).toBe(50000n)
    expect(cash && "trnType" in cash ? cash.trnType : null).toBe("CREDIT")
    expect(
      cash && "memo" in cash ? cash.memo : null,
    ).toContain("ELECTRONIC TRANSFER")
  })
})

describe("parseQuantity", () => {
  it("scales integers to 1e-8 micro-units", () => {
    expect(parseQuantity("10")).toBe(BigInt(10 * 1e8))
  })
  it("handles up to 8 decimal places losslessly", () => {
    expect(parseQuantity("0.12345678")).toBe(12345678n)
  })
  it("pads fractional zeros", () => {
    expect(parseQuantity("1.5")).toBe(150000000n)
  })
  it("rejects more than 8 decimals", () => {
    expect(parseQuantity("1.123456789")).toBeNull()
  })
  it("preserves sign", () => {
    expect(parseQuantity("-3.5")).toBe(-350000000n)
  })
})

describe("externalInvestmentAccountKey", () => {
  it("namespaces under ofx-inv:", () => {
    expect(
      externalInvestmentAccountKey({
        brokerId: "fidelity.com",
        accountId: "Z12345678",
        currency: "USD",
      }),
    ).toBe("ofx-inv:fidelity.com:Z12345678")
  })
})

describe("externalAccountKey", () => {
  it("namespaces under ofx: and uses BANKID:ACCTID for banks", () => {
    expect(
      externalAccountKey({
        institutionId: "026009593",
        accountId: "1234567890",
        accountType: "CHECKING",
        currency: "USD",
      }),
    ).toBe("ofx:026009593:1234567890")
  })

  it("uses 'unknown' as institution placeholder for credit cards", () => {
    expect(
      externalAccountKey({
        institutionId: null,
        accountId: "4111111111111111",
        accountType: null,
        currency: "USD",
      }),
    ).toBe("ofx:unknown:4111111111111111")
  })
})
