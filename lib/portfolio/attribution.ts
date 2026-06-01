import "server-only";
import type { EnrichedPortfolio } from "./types";

/**
 * Per-holding contribution to portfolio return.
 *
 * This is the simple unrealized-attribution: each holding's contribution
 * to total return is (unrealized_cad / total_cost_cad) × 100 in pp. For a
 * buy-and-hold investor with low turnover, this is functionally identical
 * to a YTD attribution and avoids needing a year-start snapshot (which
 * many users won't have yet).
 *
 * Per-row pct: (h.unrealizedCad / h.costBasisCad) × 100  →  position's own return.
 * Per-row contribution: (h.unrealizedCad / portfolio.totalCost) × 100  →
 *   how many pp this holding added to the *portfolio's* total return.
 *
 * The contributions don't quite sum to the portfolio return — the
 * portfolio return uses today's value vs cost, which our top-line already
 * computes. The card just sorts by contribution so the user sees the
 * biggest movers up top.
 */
export type AttributionRow = {
  ticker: string;
  currency: string;
  /** Holding's own return in pp (CAD). */
  returnPct: number;
  /** Portfolio-level pp contribution (CAD). */
  contributionPct: number;
  /** CAD-equivalent unrealized P&L. */
  unrealizedCad: number;
  /** CAD-equivalent cost basis. */
  costBasisCad: number;
};

export type AttributionSummary = {
  contributors: AttributionRow[];
  detractors: AttributionRow[];
  /** Total CAD unrealized; equal to portfolio.totalUnrealized for sanity. */
  totalUnrealizedCad: number;
  totalCostCad: number;
};

export function computeAttribution(args: {
  portfolio: EnrichedPortfolio;
  /** How many rows to keep on each side. Default 5. */
  topN?: number;
}): AttributionSummary {
  const topN = args.topN ?? 5;
  const totalCost = args.portfolio.totalCost;
  const rows: AttributionRow[] = [];

  for (const h of args.portfolio.holdings) {
    if (h.unrealizedCad == null) continue;
    if (h.costBasisCad <= 0) continue;
    rows.push({
      ticker: h.ticker,
      currency: h.currency,
      returnPct: (h.unrealizedCad / h.costBasisCad) * 100,
      contributionPct: totalCost > 0 ? (h.unrealizedCad / totalCost) * 100 : 0,
      unrealizedCad: h.unrealizedCad,
      costBasisCad: h.costBasisCad,
    });
  }

  const positive = rows.filter((r) => r.unrealizedCad > 0).sort((a, b) => b.unrealizedCad - a.unrealizedCad);
  const negative = rows.filter((r) => r.unrealizedCad < 0).sort((a, b) => a.unrealizedCad - b.unrealizedCad);

  return {
    contributors: positive.slice(0, topN),
    detractors: negative.slice(0, topN),
    totalUnrealizedCad: rows.reduce((s, r) => s + r.unrealizedCad, 0),
    totalCostCad: rows.reduce((s, r) => s + r.costBasisCad, 0),
  };
}
