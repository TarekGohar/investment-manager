import "server-only";
import type { Tx } from "@/lib/portfolio/types";
import { listTransactions } from "@/lib/portfolio/queries";
import { isNonRegisteredKind } from "@/lib/portfolio/holdings";
import {
  detectSuperficialLosses,
} from "@/lib/canadian/superficial-loss";
import type { BrokerageKind } from "@/generated/prisma";

/**
 * T5-style row: investment income (dividends + interest) received in a
 * given tax year. Real T5 splits eligible vs non-eligible dividends — we
 * don't yet model dividend type at the transaction level, so we report
 * gross dividend received and let the user reclassify when filing.
 */
export type T5Row = {
  ticker: string;
  /** Gross dividend / income before FWT. */
  grossIncome: number;
  /** Foreign tax withheld (recoverable as FTC on non-reg). */
  foreignTaxWithheld: number;
  /** Account kind the income was received in. */
  brokerageKind: BrokerageKind;
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
    if (tx.occurredAt.getUTCFullYear() !== year) continue;
    if (!includeRegistered && !isNonRegisteredKind(tx.brokerageKind)) continue;

    const key = `${tx.ticker}:${tx.brokerageKind}`;
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
      });
    }
  }
  return Array.from(acc.values()).sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  );
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

export async function buildT5Csv(
  userId: string,
  year: number,
  opts: { includeRegistered?: boolean } = {},
): Promise<string> {
  const transactions = await listTransactions(userId);
  const rows = buildT5Rows(transactions, year, opts);
  const total = rows.reduce(
    (acc, r) => {
      acc.gross += r.grossIncome;
      acc.fwt += r.foreignTaxWithheld;
      return acc;
    },
    { gross: 0, fwt: 0 },
  );

  return toCsv(
    [
      "Ticker",
      "Account Kind",
      "Gross Income (CAD)",
      "Foreign Tax Withheld (CAD)",
      "Net (CAD)",
    ],
    [
      ...rows.map((r) => [
        r.ticker,
        r.brokerageKind,
        r.grossIncome.toFixed(2),
        r.foreignTaxWithheld.toFixed(2),
        (r.grossIncome - r.foreignTaxWithheld).toFixed(2),
      ]),
      [
        "TOTAL",
        "",
        total.gross.toFixed(2),
        total.fwt.toFixed(2),
        (total.gross - total.fwt).toFixed(2),
      ],
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
