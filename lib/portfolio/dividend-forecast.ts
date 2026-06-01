import "server-only";
import type { BrokerageKind } from "@/generated/prisma";
import type { EnrichedPortfolio, Tx } from "./types";

/**
 * Forward 12-month dividend projection.
 *
 * Method (v1, deliberately simple):
 *   For each held ticker, sum its last 12 months of DIVIDEND transactions.
 *   That's "trailing 12-month income". Project that exact amount forward,
 *   scaled by (currentShares / averageSharesOverTtmDividends) so a ticker
 *   you doubled into mid-year doesn't underforecast.
 *
 * Caveats:
 *   - Doesn't model recent DPS hikes or cuts. If a company changed its
 *     dividend policy in the last quarter, the forecast lags by a year.
 *   - Foreign withholding tax inside an RRSP is treaty-exempted for US
 *     stocks, but absent inside a TFSA/FHSA. We bucket by account-kind so
 *     the UI can distinguish recoverable vs. lost FWT.
 *   - Assumes positions stay open. A SELL during the projection year would
 *     reduce actual receipts.
 */
export type DividendForecastRow = {
  ticker: string;
  currency: string;
  /** Quarterly cadence guess from the historical pattern; just informational. */
  observedPaymentsTtm: number;
  /** Projected forward 12-month gross dividend income (in `currency`). */
  projectedGross: number;
  /** Projected forward 12-month FWT (in `currency`). */
  projectedFwt: number;
  /** CAD-equivalent of projectedGross at today's FX. */
  projectedGrossCad: number;
  projectedFwtCad: number;
  /** Per-account-kind split of the projection in CAD. */
  byAccountKindCad: Partial<Record<BrokerageKind, number>>;
};

export type DividendForecastSummary = {
  rows: DividendForecastRow[];
  /** Totals in CAD. */
  totalProjectedGrossCad: number;
  totalProjectedFwtCad: number;
  /** Tax-bucket rollup. RRSP / TFSA / FHSA / RESP / LIRA / RRIF are
   *  sheltered (income is tax-free or tax-deferred at the account level);
   *  non-reg + corporate are taxable in the year received. */
  shelteredCad: number;
  taxableCad: number;
  /** Coverage signal — how many tickers we had at least 1 dividend on. */
  tickersWithData: number;
  /** Tickers we hold but have no dividend history for (yet). */
  tickersWithoutData: string[];
};

const NOW = () => new Date();
const TTM_MS = 365 * 86_400_000;

const SHELTERED_KINDS: BrokerageKind[] = [
  "TFSA",
  "RRSP",
  "FHSA",
  "RESP",
  "LIRA",
  "RRIF",
];

export function computeDividendForecast(args: {
  portfolio: EnrichedPortfolio;
  transactions: Tx[];
  usdToCadRate: number | null;
}): DividendForecastSummary {
  const now = NOW();
  const cutoff = new Date(now.getTime() - TTM_MS);

  // Group DIVIDEND txs by ticker — keep brokerage info for account-kind bucketing
  type DivObservation = {
    occurredAt: Date;
    gross: number;
    fwt: number;
    currency: string;
    brokerageKind: BrokerageKind;
    sharesAtTime: number | null; // best-effort from "ON N SHS" note
  };
  const divsByTicker = new Map<string, DivObservation[]>();
  for (const tx of args.transactions) {
    if (tx.kind !== "DIVIDEND") continue;
    if (!tx.ticker) continue;
    if (tx.occurredAt < cutoff) continue;
    if (tx.dividendType === "RETURN_OF_CAPITAL") continue; // not income
    const arr = divsByTicker.get(tx.ticker) ?? [];
    arr.push({
      occurredAt: tx.occurredAt,
      gross: tx.price,
      fwt: tx.foreignTaxWithheld,
      currency: tx.currency,
      brokerageKind: tx.brokerageKind,
      sharesAtTime: parseSharesFromNote(tx.note),
    });
    divsByTicker.set(tx.ticker, arr);
  }

  const rows: DividendForecastRow[] = [];
  const tickersWithoutData: string[] = [];

  for (const h of args.portfolio.holdings) {
    const observations = divsByTicker.get(h.ticker);
    if (!observations || observations.length === 0) {
      // Only flag tickers that actually look like dividend payers (skip
      // tiny / no-quote positions and obvious non-payers like CSE penny
      // stocks where the "no data" finding is just noise).
      if (h.quantity > 0) tickersWithoutData.push(h.ticker);
      continue;
    }

    const ttmGross = observations.reduce((s, o) => s + o.gross, 0);
    const ttmFwt = observations.reduce((s, o) => s + o.fwt, 0);

    // Scale by current shares / avg historical shares. If we can read
    // shares-at-time from notes, use that average; otherwise scale by ratio
    // of current_qty to qty implied by latest dividend (assume DPS stable).
    const sharesAtTimeKnown = observations
      .map((o) => o.sharesAtTime)
      .filter((n): n is number => n != null && n > 0);
    let scaleFactor = 1;
    if (sharesAtTimeKnown.length > 0) {
      const avgSharesThen =
        sharesAtTimeKnown.reduce((s, n) => s + n, 0) / sharesAtTimeKnown.length;
      if (avgSharesThen > 0) scaleFactor = h.quantity / avgSharesThen;
    }

    const projectedGross = ttmGross * scaleFactor;
    const projectedFwt = ttmFwt * scaleFactor;
    const fxFactor =
      h.currency === "CAD" ? 1 : h.currency === "USD" ? (args.usdToCadRate ?? 1) : 1;
    const projectedGrossCad = projectedGross * fxFactor;
    const projectedFwtCad = projectedFwt * fxFactor;

    // Distribute the projection across the user's current account-kind mix
    // for this ticker. Holdings already have `byKind` slices with current
    // qty per kind.
    const byAccountKindCad: Partial<Record<BrokerageKind, number>> = {};
    if (h.quantity > 0) {
      for (const [kindRaw, slice] of Object.entries(h.byKind)) {
        const kind = kindRaw as BrokerageKind;
        if (slice.quantity <= 0) continue;
        byAccountKindCad[kind] =
          (byAccountKindCad[kind] ?? 0) +
          projectedGrossCad * (slice.quantity / h.quantity);
      }
    }

    rows.push({
      ticker: h.ticker,
      currency: h.currency,
      observedPaymentsTtm: observations.length,
      projectedGross,
      projectedFwt,
      projectedGrossCad,
      projectedFwtCad,
      byAccountKindCad,
    });
  }

  rows.sort((a, b) => b.projectedGrossCad - a.projectedGrossCad);

  const totalProjectedGrossCad = rows.reduce((s, r) => s + r.projectedGrossCad, 0);
  const totalProjectedFwtCad = rows.reduce((s, r) => s + r.projectedFwtCad, 0);

  let shelteredCad = 0;
  let taxableCad = 0;
  for (const r of rows) {
    for (const [kindRaw, amount] of Object.entries(r.byAccountKindCad)) {
      const kind = kindRaw as BrokerageKind;
      if (SHELTERED_KINDS.includes(kind)) shelteredCad += amount;
      else taxableCad += amount;
    }
  }

  return {
    rows,
    totalProjectedGrossCad,
    totalProjectedFwtCad,
    shelteredCad,
    taxableCad,
    tickersWithData: rows.length,
    tickersWithoutData: tickersWithoutData.sort(),
  };
}

const SHS_RE = /ON\s+([0-9,]+(?:\.[0-9]+)?)\s+SHS/i;
function parseSharesFromNote(note: string | null): number | null {
  if (!note) return null;
  const m = note.match(SHS_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
