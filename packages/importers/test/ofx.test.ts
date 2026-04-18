import { describe, expect, it } from "vitest"
import { externalAccountKey, parseOfx } from "../src"

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

  it("counts the investment statement so the UI can warn", () => {
    expect(result.investmentStatementCount).toBe(1)
    expect(result.warnings.some((w) => /investment/i.test(w))).toBe(true)
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
