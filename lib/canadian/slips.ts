import "server-only";
import type { Tx } from "@/lib/portfolio/types";
import { listTransactions } from "@/lib/portfolio/queries";
import { isNonRegisteredKind } from "@/lib/portfolio/holdings";
import {
  detectSuperficialLosses,
} from "@/lib/canadian/superficial-loss";
import type { BrokerageKind, DividendType } from "@/generated/prisma";

/**
 * T5-style row: investment income (dividends + interest) received in a
 * given tax year. Real T5 splits eligible vs non-eligible dividends and
 * isolates interest income and foreign income separately — this rollup
 * groups by (ticker, account kind, dividendType, currency) so each row
 * lines up with one T5 box.
 */
export type T5Row = {
  ticker: string;
  /** Gross dividend / income before FWT, in the original currency. */
  grossIncome: number;
  /** Foreign tax withheld (recoverable as FTC on non-reg). */
  foreignTaxWithheld: number;
  /** Account kind the income was received in. */
  brokerageKind: BrokerageKind;
  /** Dividend type — null only if the user didn't tag the transaction. */
  dividendType: DividendType | null;
  /** Currency the dividend was received in (CAD / USD / etc.). */
  currency: string;
};

/**
 * T5008-style row: one disposition (SELL) with proceeds, ACB, and resulting
 * gain or loss. Only non-registered SELLs produce tax-relevant rows.
 */
export type T5008Row = {
  ticker: string;
  /** Date of disposition (ISO yyyy-mm-dd) */
  date: string;
  quantity: number;
  /** Net proceeds = qty * price - fees */
  proceeds: number;
  /** Adjusted cost base of the shares disposed of */
  acbOfShares: number;
  /** proceeds - acbOfShares; negative = loss */
  gainOrLoss: number;
  /** Whether CRA's superficial-loss rule disallowed this loss */
  superficialLossDisallowed: boolean;
  brokerageKind: BrokerageKind;
};

/**
 * T5 rollup for a given tax year. Aggregates DIVIDEND transactions per
 * ticker per account kind. Defaults to non-registered only since those are
 * the slips a Canadian broker would actually issue.
 */
export function buildT5Rows(
  transactions: Tx[],
  year: number,
  opts: { includeRegistered?: boolean } = {},
): T5Row[] {
  const includeRegistered = opts.includeRegistered ?? false;
  const acc = new Map<string, T5Row>();
  for (const tx of transactions) {
    if (tx.kind !== "DIVIDEND") continue;
    if (!tx.ticker) continue;
    if (tx.occurredAt.getUTCFullYear() !== year) continue;
    if (!includeRegistered && !isNonRegisteredKind(tx.brokerageKind)) continue;

    const key = `${tx.ticker}:${tx.brokerageKind}:${tx.dividendType ?? "UNTAGGED"}:${tx.currency}`;
    const existing = acc.get(key);
    if (existing) {
      existing.grossIncome += tx.price;
      existing.foreignTaxWithheld += tx.foreignTaxWithheld;
    } else {
      acc.set(key, {
        ticker: tx.ticker,
        grossIncome: tx.price,
        foreignTaxWithheld: tx.foreignTaxWithheld,
        brokerageKind: tx.brokerageKind,
        dividendType: tx.dividendType,
        currency: tx.currency,
      });
    }
  }
  return Array.from(acc.values()).sort((a, b) => {
    if (a.ticker !== b.ticker) return a.ticker.localeCompare(b.ticker);
    return (a.dividendType ?? "").localeCompare(b.dividendType ?? "");
  });
}

/**
 * T5008 rollup. Walks ACB per ticker (non-reg only) and emits one row per
 * SELL whose occurredAt falls in `year`. Mirrors the realized-gain logic
 * in deriveHoldings.
 */
export function buildT5008Rows(transactions: Tx[], year: number): T5008Row[] {
  const violations = detectSuperficialLosses(transactions);
  const superficialBySaleId = new Set(
    violations.map((v) => v.saleTransactionId),
  );

  const byTicker = new Map<string, Tx[]>();
  for (const tx of transactions) {
    if (!tx.ticker) continue;
    const arr = byTicker.get(tx.ticker) ?? [];
    arr.push(tx);
    byTicker.set(tx.ticker, arr);
  }

  const rows: T5008Row[] = [];

  for (const [ticker, txns] of byTicker) {
    const sorted = [...txns].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    let qty = 0;
    let cost = 0;

    for (const tx of sorted) {
      if (!isNonRegisteredKind(tx.brokerageKind)) continue;

      if (tx.kind === "BUY" || tx.kind === "TRANSFER_IN") {
        cost += tx.quantity * tx.price + (tx.kind === "BUY" ? tx.fees : 0);
        qty += tx.quantity;
      } else if (tx.kind === "SELL" || tx.kind === "TRANSFER_OUT") {
        if (qty <= 1e-9) continue;
        const acb = cost / qty;
        const qtySold = Math.min(tx.quantity, qty);
        const proceeds = tx.quantity * tx.price - (tx.kind === "SELL" ? tx.fees : 0);
        const acbOfShares = qtySold * acb;
        const gainOrLoss = proceeds - acbOfShares;

        if (
          tx.kind === "SELL" &&
          tx.occurredAt.getUTCFullYear() === year
        ) {
          rows.push({
            ticker,
            date: tx.occurredAt.toISOString().slice(0, 10),
            quantity: tx.quantity,
            proceeds,
            acbOfShares,
            gainOrLoss,
            superficialLossDisallowed: superficialBySaleId.has(tx.id),
            brokerageKind: tx.brokerageKind,
          });
        }

        if (superficialBySaleId.has(tx.id)) {
          // Superficial sale: cost reduces by proceeds (loss stays in pool)
          cost -= proceeds;
        } else {
          cost -= acbOfShares;
        }
        qty -= qtySold;
        if (qty <= 1e-9) {
          qty = 0;
          cost = 0;
        }
      } else if (tx.kind === "SPLIT") {
        const ratio = tx.splitRatio ?? 1;
        if (ratio > 0) qty *= ratio;
      }
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Convert rows to a CSV string. Quotes any cell that contains a comma,
 * quote, or newline. Headers come first.
 */
function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (cell: string | number) => {
    const s = String(cell);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return lines.join("\n") + "\n";
}

const DIVIDEND_TYPE_LABEL: Record<string, string> = {
  ELIGIBLE: "Eligible (T5 box 24/25)",
  NON_ELIGIBLE: "Non-eligible (T5 box 10/11)",
  INTEREST: "Interest (T5 box 13)",
  FOREIGN: "Foreign (T5 box 15)",
  RETURN_OF_CAPITAL: "Return of capital (ACB-reducing)",
  OTHER: "Other",
  UNTAGGED: "Untagged — set type",
};

export async function buildT5Csv(
  userId: string,
  year: number,
  opts: { includeRegistered?: boolean } = {},
): Promise<string> {
  const transactions = await listTransactions(userId);
  const rows = buildT5Rows(transactions, year, opts);
  // Totals per currency — we don't FX-convert so the user sees CAD and USD
  // totals separately.
  const totalsByCurrency = new Map<string, { gross: number; fwt: number }>();
  for (const r of rows) {
    const t = totalsByCurrency.get(r.currency) ?? { gross: 0, fwt: 0 };
    t.gross += r.grossIncome;
    t.fwt += r.foreignTaxWithheld;
    totalsByCurrency.set(r.currency, t);
  }

  const totalsRows = Array.from(totalsByCurrency.entries()).map(([cur, t]) => [
    `TOTAL ${cur}`,
    "",
    "",
    cur,
    t.gross.toFixed(2),
    t.fwt.toFixed(2),
    (t.gross - t.fwt).toFixed(2),
  ]);

  return toCsv(
    [
      "Ticker",
      "Account Kind",
      "Dividend Type",
      "Currency",
      "Gross Income",
      "Foreign Tax Withheld",
      "Net",
    ],
    [
      ...rows.map((r) => [
        r.ticker,
        r.brokerageKind,
        DIVIDEND_TYPE_LABEL[r.dividendType ?? "UNTAGGED"],
        r.currency,
        r.grossIncome.toFixed(2),
        r.foreignTaxWithheld.toFixed(2),
        (r.grossIncome - r.foreignTaxWithheld).toFixed(2),
      ]),
      ...totalsRows,
    ],
  );
}

export async function buildT5008Csv(
  userId: string,
  year: number,
): Promise<string> {
  const transactions = await listTransactions(userId);
  const rows = buildT5008Rows(transactions, year);
  const total = rows.reduce(
    (acc, r) => {
      if (r.superficialLossDisallowed) return acc;
      acc.proceeds += r.proceeds;
      acc.acb += r.acbOfShares;
      acc.gain += r.gainOrLoss;
      return acc;
    },
    { proceeds: 0, acb: 0, gain: 0 },
  );

  return toCsv(
    [
      "Date",
      "Ticker",
      "Account Kind",
      "Quantity",
      "Proceeds (CAD)",
      "ACB of Shares (CAD)",
      "Gain / Loss (CAD)",
      "Superficial Loss Disallowed",
    ],
    [
      ...rows.map((r) => [
        r.date,
        r.ticker,
        r.brokerageKind,
        r.quantity.toString(),
        r.proceeds.toFixed(2),
        r.acbOfShares.toFixed(2),
        r.gainOrLoss.toFixed(2),
        r.superficialLossDisallowed ? "YES" : "",
      ]),
      [
        "TOTAL (excl. disallowed)",
        "",
        "",
        "",
        total.proceeds.toFixed(2),
        total.acb.toFixed(2),
        total.gain.toFixed(2),
        "",
      ],
    ],
  );
}
