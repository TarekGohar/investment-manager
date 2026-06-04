import "server-only";
import { getTickerInsights } from "@/lib/marketdata";
import type { EnrichedHolding, Tx } from "./types";

export type UpcomingDividend = {
  ticker: string;
  /** Confirmed ex-date from Yahoo, or null. */
  exDate: Date | null;
  /** Pay-date — confirmed from Yahoo when available, otherwise projected. */
  payDate: Date;
  /** Estimated gross payout in `currency` (across all brokerages, current shares). */
  estimatedAmount: number;
  currency: string;
  /** CAD-equivalent of estimatedAmount using today's BoC rate. */
  estimatedAmountCad: number;
  /** True when pay-date is projected from the historical cadence (no Yahoo confirmation). */
  isProjected: boolean;
};

/** Quarterly is the default if we only have one prior payment. */
const DEFAULT_CADENCE_DAYS = 91;

/** Don't show events more than ~3 months out — past that, projections get sketchy. */
const LOOKAHEAD_MS = 95 * 86_400_000;

/**
 * Per-position upcoming dividends. For each holding with prior dividend
 * history, we estimate the next payout amount from the most recent quarter's
 * total (scaled to current share count) and use Yahoo's `dividendDate` when
 * available. If no confirmed date exists, we project ~one cadence period
 * after the last payment and tag it as projected.
 */
export async function getUpcomingDividends(args: {
  holdings: EnrichedHolding[];
  transactions: Tx[];
  usdToCadRate: number | null;
}): Promise<UpcomingDividend[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);

  // Group DIVIDEND txs by ticker — most recent first.
  const divsByTicker = new Map<string, Tx[]>();
  for (const tx of args.transactions) {
    if (tx.kind !== "DIVIDEND" || !tx.ticker) continue;
    if (tx.dividendType === "RETURN_OF_CAPITAL") continue;
    const arr = divsByTicker.get(tx.ticker) ?? [];
    arr.push(tx);
    divsByTicker.set(tx.ticker, arr);
  }
  for (const arr of divsByTicker.values()) {
    arr.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  // Sorted ascending for quantity-at-date walks.
  const txsAsc = [...args.transactions].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const out: UpcomingDividend[] = [];

  for (const h of args.holdings) {
    if (h.quantity <= 0) continue;
    const divs = divsByTicker.get(h.ticker);
    if (!divs || divs.length === 0) continue;

    // The most recent payout = all dividend txs sharing the same occurredAt
    // as the latest one (brokerages pay on the same date).
    const mostRecent = divs[0];
    const sameDayTotal = divs
      .filter((d) => sameDay(d.occurredAt, mostRecent.occurredAt))
      .reduce((s, d) => s + d.price, 0);

    // Per-share rate from that payout, using qty held on that date.
    const qtyAtLastPayout = quantityAt(txsAsc, h.ticker, mostRecent.occurredAt);
    if (qtyAtLastPayout <= 0) continue;
    const perShare = sameDayTotal / qtyAtLastPayout;
    const estimatedAmount = perShare * h.quantity;

    const insights = await getTickerInsights(h.ticker);
    let payDate = insights?.dividendDate ?? null;
    const exDate = insights?.exDividendDate ?? null;
    let isProjected = false;

    if (!payDate || payDate < now) {
      const cadence = inferCadenceDays(divs);
      payDate = new Date(mostRecent.occurredAt.getTime() + cadence * 86_400_000);
      isProjected = true;
    }
    if (payDate > horizon) continue;

    const currency = mostRecent.currency;
    const fxFactor =
      currency === "CAD" ? 1 : currency === "USD" ? (args.usdToCadRate ?? 1) : 1;
    const estimatedAmountCad = estimatedAmount * fxFactor;

    out.push({
      ticker: h.ticker,
      exDate: exDate && exDate >= now ? exDate : null,
      payDate,
      estimatedAmount,
      currency,
      estimatedAmountCad,
      isProjected,
    });
  }

  return out.sort((a, b) => a.payDate.getTime() - b.payDate.getTime());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Walk transactions up to `asOf` and return aggregate qty for `ticker`. */
function quantityAt(txsAsc: Tx[], ticker: string, asOf: Date): number {
  let qty = 0;
  for (const tx of txsAsc) {
    if (tx.occurredAt > asOf) break;
    if (tx.ticker !== ticker) continue;
    switch (tx.kind) {
      case "BUY":
      case "TRANSFER_IN":
        qty += tx.quantity;
        break;
      case "SELL":
      case "TRANSFER_OUT":
        qty -= tx.quantity;
        break;
      case "SPLIT":
        qty *= tx.splitRatio ?? 1;
        break;
    }
  }
  return qty;
}

/**
 * Distance in days between the two most recent distinct payout dates. Falls
 * back to ~quarterly when only one payment exists. Clamped so a one-off
 * special dividend doesn't anchor projections to a bizarre cadence.
 */
function inferCadenceDays(divsDesc: Tx[]): number {
  const distinctDates: Date[] = [];
  for (const d of divsDesc) {
    if (distinctDates.length === 0 || !sameDay(d.occurredAt, distinctDates[distinctDates.length - 1])) {
      distinctDates.push(d.occurredAt);
    }
    if (distinctDates.length >= 2) break;
  }
  if (distinctDates.length < 2) return DEFAULT_CADENCE_DAYS;
  const diffDays = Math.abs(distinctDates[0].getTime() - distinctDates[1].getTime()) / 86_400_000;
  // Clamp to monthly..annual to swallow special dividends or data quirks.
  return Math.max(28, Math.min(366, diffDays));
}
