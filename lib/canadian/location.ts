import "server-only";
import type { BrokerageKind } from "@/generated/prisma";
import type { Fundamentals } from "@/lib/marketdata";

/**
 * Canadian asset-location analysis.
 *
 * Scoring model (simplified — adequate for retail):
 *
 *   ┌─ asset class ─────────────┬─ optimal account ─┬─ rationale ──────────────┐
 *   │ US dividend payer (≥0.5%) │ RRSP              │ 0% FWT under tax treaty  │
 *   │ Canadian eligible div     │ Non-registered    │ Dividend tax credit      │
 *   │ Growth (yield < 0.5%)     │ TFSA              │ Tax-free compounding     │
 *   │ Bonds / REITs (high yield)│ RRSP              │ Income deferred          │
 *   └───────────────────────────┴───────────────────┴──────────────────────────┘
 *
 * Caveats:
 * - Canadian-listed ETFs that wrap US assets (VFV, ZSP) still incur 15% FWT
 *   *inside* the ETF before distribution. The treaty does not pass through
 *   to RRSPs for these wrappers. We don't yet have a way to tell wrappers
 *   apart from real Canadian companies — flagged as "warning" rather than
 *   silently misclassifying. Future: maintain a tagged ETF lookup table.
 * - REIT distributions are treated as Canadian eligible dividends here even
 *   though parts may be return-of-capital. Refine in Session 4.
 */

const US_EXCHANGE_PATTERNS = [
  /nasdaq/i,
  /\bnyse\b/i,
  /new york stock/i,
  /arca/i,
  /bats/i,
  /amex/i,
  /nyse mkt/i,
];

const CA_EXCHANGE_PATTERNS = [
  /toronto stock/i,
  /\btsx\b/i,
  /tsxv/i,
  /\bneo\b/i,
  /\bcse\b/i,
  /canadian securities/i,
];

export function isUSListed(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return US_EXCHANGE_PATTERNS.some((p) => p.test(exchange));
}

export function isCanadianListed(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return CA_EXCHANGE_PATTERNS.some((p) => p.test(exchange));
}

export type LocationScore = "optimal" | "suboptimal" | "mislocated" | "unknown";

export type LocationAnalysis = {
  ticker: string;
  currentKind: BrokerageKind;
  optimalKind: BrokerageKind | null;
  score: LocationScore;
  reasoning: string;
  /** Approx $CAD lost per year due to current location vs. optimal. Positive numbers only. */
  estimatedAnnualBleed: number;
  /** Approx annual dividend $CAD given current marketValue × yield. */
  expectedAnnualDividend: number;
  /** Annual FWT cost on foreign dividends, at current location. */
  expectedAnnualFWT: number;
};

type Input = {
  ticker: string;
  currentKind: BrokerageKind;
  marketValue: number; // $CAD value of the slice in this account
  fundamentals: Fundamentals | null;
};

/**
 * Analyze a single (ticker, account-type, market-value) slice. Returns
 * structured scoring so the UI can render a chip + reasoning + bleed.
 */
export function analyzeLocation({
  ticker,
  currentKind,
  marketValue,
  fundamentals,
}: Input): LocationAnalysis {
  const yieldPct = fundamentals?.dividendYield ?? 0; // already a decimal fraction in our schema
  const expectedAnnualDividend = Math.max(0, marketValue * yieldPct);

  const us = isUSListed(fundamentals?.exchange);
  const ca = isCanadianListed(fundamentals?.exchange);

  // No fundamentals at all
  if (!fundamentals) {
    return {
      ticker,
      currentKind,
      optimalKind: null,
      score: "unknown",
      reasoning: "Fundamentals not cached yet — open the position page once to populate.",
      estimatedAnnualBleed: 0,
      expectedAnnualDividend: 0,
      expectedAnnualFWT: 0,
    };
  }

  // ─── US dividend payer ───────────────────────────────────────────
  if (us && yieldPct >= 0.005) {
    const fwtIfRegistered = expectedAnnualDividend * 0.15;
    if (currentKind === "RRSP" || currentKind === "LIRA" || currentKind === "RRIF") {
      return {
        ticker,
        currentKind,
        optimalKind: "RRSP",
        score: "optimal",
        reasoning:
          "US dividend payer in RRSP — the Canada-US tax treaty waives the 15% foreign withholding tax. Optimal location.",
        estimatedAnnualBleed: 0,
        expectedAnnualDividend,
        expectedAnnualFWT: 0,
      };
    }
    if (currentKind === "TFSA" || currentKind === "FHSA") {
      return {
        ticker,
        currentKind,
        optimalKind: "RRSP",
        score: "mislocated",
        reasoning: `15% withheld on US dividends inside TFSA/FHSA is non-recoverable. Moving to RRSP saves about ${fmt(fwtIfRegistered)}/yr.`,
        estimatedAnnualBleed: fwtIfRegistered,
        expectedAnnualDividend,
        expectedAnnualFWT: fwtIfRegistered,
      };
    }
    // Non-reg: FWT withheld but recoverable via T1 foreign tax credit; dividends still ordinary income
    return {
      ticker,
      currentKind,
      optimalKind: "RRSP",
      score: "suboptimal",
      reasoning:
        "Non-registered: 15% FWT is recoverable via foreign tax credit, but the dividend is fully taxable at your marginal rate. RRSP defers tax + waives FWT.",
      estimatedAnnualBleed: 0, // hard to quantify without knowing marginal rate; leave 0
      expectedAnnualDividend,
      expectedAnnualFWT: expectedAnnualDividend * 0.15,
    };
  }

  // ─── Canadian eligible dividend payer ────────────────────────────
  if (ca && yieldPct >= 0.01) {
    // Approximate value of the dividend tax credit vs ordinary income —
    // for Quebec top bracket, eligible dividend rate ~ 39.83% vs ordinary 53.31%
    // so the DTC saves ~13.5% of the dividend amount.
    const dtcSaving = expectedAnnualDividend * 0.135;
    if (currentKind === "NON_REGISTERED" || currentKind === "JOINT_NON_REGISTERED") {
      return {
        ticker,
        currentKind,
        optimalKind: "NON_REGISTERED",
        score: "optimal",
        reasoning:
          "Canadian eligible dividend in non-registered — dividend tax credit applies, lowest effective rate of any income type.",
        estimatedAnnualBleed: 0,
        expectedAnnualDividend,
        expectedAnnualFWT: 0,
      };
    }
    if (currentKind === "TFSA" || currentKind === "FHSA") {
      return {
        ticker,
        currentKind,
        optimalKind: "NON_REGISTERED",
        score: "suboptimal",
        reasoning: `TFSA shelters the dividend but you're wasting the Canadian dividend tax credit. Non-reg would net out similarly with the DTC.`,
        estimatedAnnualBleed: 0, // both are roughly equivalent for cash-flow
        expectedAnnualDividend,
        expectedAnnualFWT: 0,
      };
    }
    if (currentKind === "RRSP" || currentKind === "LIRA" || currentKind === "RRIF") {
      return {
        ticker,
        currentKind,
        optimalKind: "NON_REGISTERED",
        score: "suboptimal",
        reasoning: `In RRSP you defer tax, but on withdrawal it's taxed as ordinary income — losing the DTC value (~${fmt(dtcSaving)}/yr vs holding in non-reg).`,
        estimatedAnnualBleed: dtcSaving,
        expectedAnnualDividend,
        expectedAnnualFWT: 0,
      };
    }
  }

  // ─── Growth-oriented (low/no dividend) ───────────────────────────
  if (yieldPct < 0.005) {
    if (currentKind === "TFSA" || currentKind === "FHSA") {
      return {
        ticker,
        currentKind,
        optimalKind: "TFSA",
        score: "optimal",
        reasoning:
          "Growth-oriented asset in tax-free account — all upside compounds untaxed. Ideal location.",
        estimatedAnnualBleed: 0,
        expectedAnnualDividend,
        expectedAnnualFWT: 0,
      };
    }
    if (currentKind === "RRSP" || currentKind === "LIRA" || currentKind === "RRIF") {
      return {
        ticker,
        currentKind,
        optimalKind: "TFSA",
        score: "suboptimal",
        reasoning: "Growth in RRSP defers tax but converts capital gains to ordinary income at withdrawal. TFSA preserves tax-free status.",
        estimatedAnnualBleed: 0,
        expectedAnnualDividend,
        expectedAnnualFWT: 0,
      };
    }
    // Non-reg: capital gains at 50% inclusion eventually
    return {
      ticker,
      currentKind,
      optimalKind: "TFSA",
      score: "suboptimal",
      reasoning:
        "Non-reg works (50% inclusion on cap gains) but TFSA would shelter all of it. Move if you have room.",
      estimatedAnnualBleed: 0,
      expectedAnnualDividend,
      expectedAnnualFWT: 0,
    };
  }

  // ─── Catch-all ───────────────────────────────────────────────────
  return {
    ticker,
    currentKind,
    optimalKind: null,
    score: "unknown",
    reasoning: "Couldn't classify this holding's optimal location with current data.",
    estimatedAnnualBleed: 0,
    expectedAnnualDividend,
    expectedAnnualFWT: 0,
  };
}

export type HoldingLocationAnalysis = {
  ticker: string;
  perKind: LocationAnalysis[];
  worstScore: LocationScore;
  totalEstimatedBleed: number;
  totalExpectedAnnualDividend: number;
  totalExpectedAnnualFWT: number;
};

const SCORE_ORDER: Record<LocationScore, number> = {
  mislocated: 3,
  suboptimal: 2,
  unknown: 1,
  optimal: 0,
};

/**
 * Analyze every non-zero slice of a holding and roll up the worst score
 * + total annual bleed. For display on the Position page (per-slice) and
 * the Portfolio/Dashboard (aggregate).
 */
export function analyzeHoldingLocation(args: {
  ticker: string;
  byKind: Record<BrokerageKind, { quantity: number }>;
  marketPrice: number | null;
  fundamentals: Fundamentals | null;
}): HoldingLocationAnalysis {
  const { ticker, byKind, marketPrice, fundamentals } = args;
  const perKind: LocationAnalysis[] = [];
  let worstScore: LocationScore = "optimal";
  let totalBleed = 0;
  let totalDiv = 0;
  let totalFWT = 0;

  for (const [kindKey, slice] of Object.entries(byKind)) {
    if (slice.quantity <= 0) continue;
    const kind = kindKey as BrokerageKind;
    const marketValue = (marketPrice ?? 0) * slice.quantity;
    const analysis = analyzeLocation({
      ticker,
      currentKind: kind,
      marketValue,
      fundamentals,
    });
    perKind.push(analysis);
    if (SCORE_ORDER[analysis.score] > SCORE_ORDER[worstScore]) {
      worstScore = analysis.score;
    }
    totalBleed += analysis.estimatedAnnualBleed;
    totalDiv += analysis.expectedAnnualDividend;
    totalFWT += analysis.expectedAnnualFWT;
  }

  return {
    ticker,
    perKind,
    worstScore,
    totalEstimatedBleed: totalBleed,
    totalExpectedAnnualDividend: totalDiv,
    totalExpectedAnnualFWT: totalFWT,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
}

export const SCORE_LABEL: Record<LocationScore, string> = {
  optimal: "Optimal",
  suboptimal: "Sub-optimal",
  mislocated: "Mis-located",
  unknown: "Unknown",
};

export const SCORE_TONE: Record<LocationScore, string> = {
  optimal: "bg-success/15 text-success",
  suboptimal: "bg-warning/15 text-warning",
  mislocated: "bg-danger/15 text-danger",
  unknown: "bg-muted/15 text-muted",
};

import { getFundamentals } from "@/lib/marketdata";
import type { EnrichedHolding } from "@/lib/portfolio/types";

/**
 * Batch-analyze every holding in a portfolio. Fetches fundamentals (cached)
 * in parallel and returns a map keyed by ticker.
 */
export async function analyzePortfolioLocation(
  holdings: EnrichedHolding[],
): Promise<{
  byTicker: Map<string, HoldingLocationAnalysis>;
  totalEstimatedBleed: number;
  mislocatedCount: number;
  suboptimalCount: number;
}> {
  const fundamentals = await Promise.all(
    holdings.map((h) => getFundamentals(h.ticker)),
  );

  const byTicker = new Map<string, HoldingLocationAnalysis>();
  let totalEstimatedBleed = 0;
  let mislocatedCount = 0;
  let suboptimalCount = 0;

  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    const analysis = analyzeHoldingLocation({
      ticker: h.ticker,
      byKind: h.byKind,
      marketPrice: h.marketPrice,
      fundamentals: fundamentals[i],
    });
    byTicker.set(h.ticker, analysis);
    totalEstimatedBleed += analysis.totalEstimatedBleed;
    if (analysis.worstScore === "mislocated") mislocatedCount += 1;
    else if (analysis.worstScore === "suboptimal") suboptimalCount += 1;
  }

  return { byTicker, totalEstimatedBleed, mislocatedCount, suboptimalCount };
}
