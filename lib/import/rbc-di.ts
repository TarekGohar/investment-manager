/**
 * RBC Direct Investing Activity export translator.
 *
 * Input: the raw text content of an "Activity Export" CSV downloaded from
 * RBC DI. Output: a structured preview — one row per source CSV line,
 * tagged as either a buildable Transaction, an intentional skip, or a
 * needs-manual-review case the user should handle in the regular form.
 *
 * The RBC DI export format (as of May 2026):
 *
 *   Line 1: "Activity Export as of <timestamp>"
 *   Line 2: blank
 *   Line 3: "Account: <number> - <type>"      ← we read this
 *   Line 4: blank
 *   Line 5: "Trades this month: N"
 *   Line 6: blank
 *   Line 7: "N Activities"
 *   Line 8: blank
 *   Line 9: header row: Date,Activity,Symbol,Symbol Description,Quantity,
 *           Price,Settlement Date,Account,Value,Currency,Description
 *   Lines 10..M: data rows
 *   blank line
 *   "Disclaimers"
 *   ... boilerplate ...
 *
 * Activity values seen, and how we map them:
 *   "Buy"                          → BUY      (qty as-is)
 *   "Sell"                         → SELL     (RBC has negative qty; we flip)
 *   "Dividends"                    → DIVIDEND (foreign vs eligible from desc)
 *   "Deposits & Contributions"     → DEPOSIT
 *   "Withdrawals & De-registrations" → WITHDRAWAL
 *   "Transfers"                    → SKIPPED  (internal currency journals;
 *                                              cash FX swaps. Recorded by
 *                                              user manually if needed.)
 *   "Reorganization"               → REVIEW   (splits / CIL / corp actions —
 *                                              ratio can't be reliably
 *                                              inferred from the row alone)
 */
import type {
  BrokerageKind,
  DividendType,
  TransactionKind,
} from "@/generated/prisma";
import { parseCsv, buildColumnIndex } from "./csv";

/** A transaction translated from one CSV row, ready to be persisted. */
export type ImportableTx = {
  /** Position in the source file (1-based, header is line 0). For UI display. */
  sourceLine: number;
  kind: TransactionKind;
  ticker: string | null;
  currency: string;
  quantity: number;
  price: number;
  fees: number;
  occurredAt: Date;
  dividendType: DividendType | null;
  note: string | null;
};

/** A row we deliberately skip with an explanation the UI can show. */
export type SkippedRow = {
  sourceLine: number;
  reason: "INTERNAL_TRANSFER" | "FX_CONVERSION" | "UNSUPPORTED_ACTIVITY";
  raw: Record<string, string>;
  hint: string;
};

/** A row that needs the user to make a decision before we record it. */
export type ReviewRow = {
  sourceLine: number;
  reason: "REORGANIZATION";
  raw: Record<string, string>;
  hint: string;
};

/** A row we couldn't even parse (bad date, missing required field, etc.). */
export type ErrorRow = {
  sourceLine: number;
  reason: "PARSE_ERROR";
  raw: Record<string, string>;
  error: string;
};

export type RbcDiTranslation = {
  /** Account number from the preamble (e.g. "57819938"). */
  accountNumber: string;
  /** Account kind from the preamble — matches our BrokerageKind enum. */
  accountKind: BrokerageKind;
  importableTxs: ImportableTx[];
  skipped: SkippedRow[];
  needsReview: ReviewRow[];
  errors: ErrorRow[];
};

/**
 * Map the raw RBC DI "Account: X - Y" preamble line's account-type word to
 * our BrokerageKind enum. RBC's labels match our enum names except where
 * noted.
 */
const ACCOUNT_KIND_MAP: Record<string, BrokerageKind> = {
  RRSP: "RRSP",
  TFSA: "TFSA",
  FHSA: "FHSA",
  RESP: "RESP",
  LIRA: "LIRA",
  RRIF: "RRIF",
  // RBC labels non-registered accounts as "Cash" or "Margin"
  CASH: "NON_REGISTERED",
  MARGIN: "NON_REGISTERED",
  "NON-REGISTERED": "NON_REGISTERED",
  "JOINT CASH": "JOINT_NON_REGISTERED",
};

export function translateRbcDi(fileText: string): RbcDiTranslation {
  const accountInfo = extractAccountInfo(fileText);
  const csvBody = stripPreambleAndDisclaimers(fileText);
  const { header, rows } = parseCsv(csvBody);
  const idx = buildColumnIndex(header);

  // Required columns. If any is missing the file isn't an RBC DI Activity
  // export and we bail loudly.
  const requiredCols = [
    "Date",
    "Activity",
    "Symbol",
    "Quantity",
    "Price",
    "Value",
    "Currency",
    "Description",
  ];
  for (const col of requiredCols) {
    if (idx(col) === undefined) {
      throw new Error(
        `RBC DI import: missing required column "${col}". Header was: ${header.join(", ")}`,
      );
    }
  }

  const importableTxs: ImportableTx[] = [];
  const skipped: SkippedRow[] = [];
  const needsReview: ReviewRow[] = [];
  const errors: ErrorRow[] = [];

  // sourceLine in the original file — preamble is 8 lines, header is line 9,
  // so first data row is line 10. We compute that offset for display.
  const HEADER_LINE = 9;
  rows.forEach((row, rowIndex) => {
    const sourceLine = HEADER_LINE + 1 + rowIndex;
    const raw = toRawObject(header, row);
    try {
      const translated = translateRow(raw, sourceLine);
      if (translated.kind === "skip") skipped.push(translated.value);
      else if (translated.kind === "review") needsReview.push(translated.value);
      else importableTxs.push(translated.value);
    } catch (err) {
      errors.push({
        sourceLine,
        reason: "PARSE_ERROR",
        raw,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return {
    accountNumber: accountInfo.number,
    accountKind: accountInfo.kind,
    importableTxs,
    skipped,
    needsReview,
    errors,
  };
}

// ─── Preamble / file-shape handling ───────────────────────────────────

function extractAccountInfo(fileText: string): {
  number: string;
  kind: BrokerageKind;
} {
  // Find a line like:  "Account: 57819938 - RRSP"
  // The line is quoted in the export, but parsing the raw text is more
  // resilient than parsing the entire file as CSV first.
  const m = fileText.match(/"Account:\s*([0-9A-Za-z-]+)\s*-\s*([^"]+)"/);
  if (!m) {
    throw new Error(
      "RBC DI import: couldn't find an Account preamble line. Is this the right file?",
    );
  }
  const number = m[1].trim();
  const kindLabel = m[2].trim().toUpperCase();
  const kind = ACCOUNT_KIND_MAP[kindLabel];
  if (!kind) {
    throw new Error(
      `RBC DI import: unrecognized account type "${kindLabel}". Add it to ACCOUNT_KIND_MAP in lib/import/rbc-di.ts.`,
    );
  }
  return { number, kind };
}

/**
 * Trim the surrounding preamble and disclaimers so we hand the CSV parser
 * just the header + data rows. The header begins with `"Date","Activity",`
 * and the data ends at a blank line followed by `"Disclaimers"`.
 */
function stripPreambleAndDisclaimers(fileText: string): string {
  const headerStart = fileText.indexOf('"Date","Activity",');
  if (headerStart === -1) {
    throw new Error(
      "RBC DI import: couldn't find the header row starting with \"Date\",\"Activity\". Is this the right file?",
    );
  }
  const afterHeader = fileText.slice(headerStart);
  const disclaimerStart = afterHeader.indexOf("\n\n\"Disclaimers\"");
  return disclaimerStart === -1 ? afterHeader : afterHeader.slice(0, disclaimerStart);
}

function toRawObject(header: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  header.forEach((h, i) => {
    out[h] = (row[i] ?? "").trim();
  });
  return out;
}

// ─── Row translation ──────────────────────────────────────────────────

type TranslationResult =
  | { kind: "tx"; value: ImportableTx }
  | { kind: "skip"; value: SkippedRow }
  | { kind: "review"; value: ReviewRow };

function translateRow(
  raw: Record<string, string>,
  sourceLine: number,
): TranslationResult {
  const activity = raw["Activity"];
  const description = raw["Description"];

  // The Description column is the source-of-truth subtype tag. Use the
  // 3-letter prefix when present to disambiguate.
  const descPrefix = description.slice(0, 3).toUpperCase();

  // Transfers — multiple subtypes, all of which we currently skip.
  if (activity === "Transfers") {
    if (descPrefix === "TRF" && /FOREIGN EXCHANGE/.test(description)) {
      return {
        kind: "skip",
        value: {
          sourceLine,
          reason: "FX_CONVERSION",
          raw,
          hint:
            "Cash USD↔CAD swap inside the account. Doesn't affect ACB or positions; record manually if you want to track per-currency cash balances.",
        },
      };
    }
    return {
      kind: "skip",
      value: {
        sourceLine,
        reason: "INTERNAL_TRANSFER",
        raw,
        hint:
          "Internal RBC journal (e.g. moving a security between CAD and USD books). No real-world tax event — record manually only if needed.",
      },
    };
  }

  // Reorganization — too varied to auto-handle reliably.
  if (activity === "Reorganization") {
    return {
      kind: "review",
      value: {
        sourceLine,
        reason: "REORGANIZATION",
        raw,
        hint: hintForReorganization(description),
      },
    };
  }

  const occurredAt = parseRbcDate(raw["Date"]);
  const currency = raw["Currency"].toUpperCase() || "CAD";
  const ticker = normalizeTicker(raw["Symbol"].toUpperCase() || null, currency);

  switch (activity) {
    case "Buy":
    case "Sell": {
      // When the description carries "EXCHANGE RATE ..." it means the
      // price column is in one currency (security's native) but the value
      // column has been converted to another (RBC's reporting currency for
      // the account). We can't reliably compute fees or place the row in
      // the right ACB pool without parsing both sides, so flag it for
      // manual entry instead of silently mis-recording.
      if (/EXCHANGE RATE/i.test(description)) {
        return {
          kind: "review",
          value: {
            sourceLine,
            reason: "REORGANIZATION",
            raw,
            hint: "Cross-currency trade — RBC reported the value in a different currency than the price. Record manually so the FX rate and fees are right.",
          },
        };
      }
      const qtyRaw = parseNumber(raw["Quantity"]);
      const price = parseNumber(raw["Price"]);
      const value = parseNumber(raw["Value"]);
      if (qtyRaw == null || price == null || value == null) {
        throw new Error(
          `${activity} row missing required numeric field (quantity/price/value)`,
        );
      }
      const qty = Math.abs(qtyRaw);
      // Commission is the gap between qty*price and the absolute value RBC
      // settled. BUY: value is negative and includes commission added to
      // the cost. SELL: value is positive and is qty*price minus commission.
      const grossDollars = qty * price;
      const fees =
        activity === "Buy"
          ? Math.max(0, Math.abs(value) - grossDollars)
          : Math.max(0, grossDollars - Math.abs(value));
      return {
        kind: "tx",
        value: {
          sourceLine,
          kind: activity === "Buy" ? "BUY" : "SELL",
          ticker,
          currency,
          quantity: qty,
          price,
          fees: round4(fees),
          occurredAt,
          dividendType: null,
          note: shortNote(description),
        },
      };
    }

    case "Dividends": {
      const value = parseNumber(raw["Value"]);
      if (value == null) throw new Error("Dividend row missing Value");
      // Classify by issuer, not by withholding hint. The NON-RES note can
      // be absent on foreign dividends inside an RRSP (US-Canada treaty
      // waives WHT) — so a hint-based heuristic mis-classifies US-paid
      // RRSP dividends as ELIGIBLE. Ticker shape is more reliable.
      const dividendType: DividendType = classifyDividendByTicker(ticker);
      const hasWhtHint = /NON-RES TAX WITHHELD/i.test(description);
      const baseNote = shortNote(description);
      const note =
        dividendType === "FOREIGN" && hasWhtHint && baseNote
          ? `${baseNote} · FWT not in export — fill from T5/T3 if claiming FTC`
          : baseNote;
      return {
        kind: "tx",
        value: {
          sourceLine,
          kind: "DIVIDEND",
          ticker,
          currency,
          quantity: 1,
          price: value,
          fees: 0,
          occurredAt,
          dividendType,
          note,
        },
      };
    }

    case "Deposits & Contributions": {
      const value = parseNumber(raw["Value"]);
      if (value == null) throw new Error("Deposit row missing Value");
      return {
        kind: "tx",
        value: {
          sourceLine,
          kind: "DEPOSIT",
          ticker: null,
          currency,
          quantity: 1,
          price: Math.abs(value),
          fees: 0,
          occurredAt,
          dividendType: null,
          note: shortNote(description),
        },
      };
    }

    case "Withdrawals & De-registrations": {
      const value = parseNumber(raw["Value"]);
      if (value == null) throw new Error("Withdrawal row missing Value");
      return {
        kind: "tx",
        value: {
          sourceLine,
          kind: "WITHDRAWAL",
          ticker: null,
          currency,
          quantity: 1,
          price: Math.abs(value),
          fees: 0,
          occurredAt,
          dividendType: null,
          note: shortNote(description),
        },
      };
    }

    default:
      return {
        kind: "skip",
        value: {
          sourceLine,
          reason: "UNSUPPORTED_ACTIVITY",
          raw,
          hint: `Unrecognized Activity "${activity}" — add a case to lib/import/rbc-di.ts if you want this supported.`,
        },
      };
  }
}

function hintForReorganization(desc: string): string {
  if (/STK SPLIT/i.test(desc)) {
    return "Forward stock split. Add a SPLIT transaction manually with the correct ratio (new shares per old share).";
  }
  if (/REV(\s+SPLIT)?/i.test(desc) || /REVERSE SPLIT/i.test(desc)) {
    return "Reverse split. Add a SPLIT transaction manually with ratio < 1 (e.g. 1/35 for a 1-for-35).";
  }
  if (/CIL|CASH IN LIEU/i.test(desc)) {
    return "Cash in lieu of fractional shares. Record manually as a small DIVIDEND with type OTHER, or absorb into ACB.";
  }
  return "Corporate action. Review and record manually — TRANSFER_IN / TRANSFER_OUT pair or SPLIT depending on the event.";
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseRbcDate(s: string): Date {
  // "May 25, 2026" → ISO. Date.parse handles this in Node but let's be
  // explicit so we can give a useful error.
  const trimmed = s.trim();
  if (!trimmed) throw new Error("Date field is empty");
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new Error(`Couldn't parse date: "${trimmed}"`);
  }
  // Normalize to UTC midnight on the calendar date — broker activity is
  // date-only, not timestamped.
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseNumber(s: string): number | null {
  if (!s || !s.trim()) return null;
  // RBC values can include commas: "16,400.50". Strip them.
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function shortNote(desc: string): string | null {
  if (!desc) return null;
  // Strip the leading 3-letter prefix + dash if present ("CON - CONTRIBUTION" → "CONTRIBUTION").
  return desc.replace(/^[A-Z]{3}\s*-\s*/, "").slice(0, 200) || null;
}

/**
 * Best-effort dividend classification by ticker shape.
 *  - Canadian listings (.TO, .V, .NE, .CN suffix) → ELIGIBLE
 *  - Known Canadian large-cap symbols without suffix on US-side bookkeeping → ELIGIBLE
 *  - Anything else (US naked tickers, EU ADRs, etc.) → FOREIGN
 * User can override per-row after import.
 */
const KNOWN_CANADIAN_NAKED_TICKERS = new Set([
  // Big banks
  "RY", "TD", "BNS", "BMO", "CM", "NA",
  // Lifecos
  "MFC", "SLF", "GWO",
  // Energy
  "SU", "CNQ", "ENB", "TRP", "CVE", "IMO", "TOU",
  // Telecom
  "BCE", "T", "RCI",
  // Materials / industrials
  "NTR", "CP", "CNR", "WCN", "GFL", "AEM", "FNV", "WPM", "NEM",
  // Retail / consumer
  "L", "ATD", "DOL", "MG", "OTEX",
  // Tech (cross-listed)
  "SHOP",
]);

function classifyDividendByTicker(ticker: string | null): DividendType {
  if (!ticker) return "OTHER";
  const t = ticker.toUpperCase();
  if (/\.(TO|V|NE|CN)$/.test(t)) return "ELIGIBLE";
  if (KNOWN_CANADIAN_NAKED_TICKERS.has(t)) return "ELIGIBLE";
  return "FOREIGN";
}

/**
 * RBC reports Canadian large-caps as naked tickers ("RY" instead of "RY.TO")
 * even though the user holds the TSX listing. Downstream `quoteCurrencyForTicker`
 * treats anything without `.TO/.V/.NE/.CN` as USD-listed and routes quotes
 * to the wrong provider. Normalize at import time: if the row's currency is
 * CAD AND the symbol is in our known-Canadian list AND has no exchange
 * suffix, append `.TO`. The currency check guards against the (rare) case
 * where RBC reports a true US-side trade of a cross-listed name.
 */
function normalizeTicker(ticker: string | null, currency: string): string | null {
  if (!ticker) return null;
  if (currency !== "CAD") return ticker;
  if (/\.(TO|V|NE|CN)$/.test(ticker)) return ticker;
  if (KNOWN_CANADIAN_NAKED_TICKERS.has(ticker)) return `${ticker}.TO`;
  return ticker;
}
