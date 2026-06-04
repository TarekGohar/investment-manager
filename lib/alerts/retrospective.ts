import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { computeDrift, getInvestmentPolicy } from "@/lib/policy/ips";
import type {
  AlertEvent,
  AlertSource,
  RecommendedAction,
  DecisionOutcome,
} from "@/generated/prisma";

/**
 * Pure read-only computations over closed AlertEvent rows. Everything here
 * derives — no writes, no side effects. The Hub stores recommendations and
 * outcomes; this module asks "how have those decisions actually played out?"
 *
 * Because the platform records outcomes manually, every metric here is
 * grounded in what the user *actually did* — not in what was inferred from
 * the Transaction ledger. The two never need to be reconciled.
 */

const MONTH_MS = 30 * 86_400_000;

const EXECUTED_OUTCOMES: DecisionOutcome[] = [
  "EXECUTED_AS_RECOMMENDED",
  "EXECUTED_REVISED",
];

const DIRECTIONAL_ACTIONS: RecommendedAction[] = [
  "ADD",
  "TRIM",
  "EXIT",
  "HOLD_THROUGH_DRAWDOWN",
];

// ─── Hit rate on executed directional decisions ───────────────────────────

export type HitRateRow = {
  horizonDays: number;
  totalScored: number;
  hits: number;
  hitRatePct: number; // 0-100, null if totalScored = 0
  avgReturnPct: number;
};

export type HitRateResult = {
  totalDecisions: number;
  scoredDecisions: number;
  byHorizon: HitRateRow[];
};

/**
 * Did the position move in the direction the recommendation implied?
 * ADD / HOLD_THROUGH_DRAWDOWN are "right" when price goes up.
 * TRIM / EXIT are "right" when price goes down.
 *
 * Scored at 30/90/180/365 day horizons against the ticker's Candle history.
 * Decisions without a ticker (portfolio-level rebalances) are excluded —
 * they need a separate framework.
 */
export async function getHitRate(args: {
  userId: string;
  sinceMonths: number;
}): Promise<HitRateResult> {
  const since = new Date(Date.now() - args.sinceMonths * MONTH_MS);
  const closed = await prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      outcome: { in: EXECUTED_OUTCOMES },
      ticker: { not: null },
      recommendedAction: { in: DIRECTIONAL_ACTIONS },
      outcomeRecordedAt: { gte: since },
    },
    select: {
      ticker: true,
      recommendedAction: true,
      firedAt: true,
    },
  });

  const horizons = [30, 90, 180, 365];
  const accum: Record<number, { scored: number; hits: number; sumReturn: number }> = {};
  for (const h of horizons) accum[h] = { scored: 0, hits: 0, sumReturn: 0 };

  for (const ev of closed) {
    if (!ev.ticker || !ev.recommendedAction) continue;
    const baseline = await closestCandle(ev.ticker, ev.firedAt, "before");
    if (!baseline) continue;

    for (const h of horizons) {
      const targetDate = new Date(ev.firedAt.getTime() + h * 86_400_000);
      if (targetDate.getTime() > Date.now()) continue; // horizon hasn't elapsed
      const future = await closestCandle(ev.ticker, targetDate, "after");
      if (!future) continue;
      const ret = (future.close.toNumber() - baseline.close.toNumber()) / baseline.close.toNumber();
      const expectsUp =
        ev.recommendedAction === "ADD" ||
        ev.recommendedAction === "HOLD_THROUGH_DRAWDOWN";
      const hit = expectsUp ? ret > 0 : ret < 0;
      accum[h].scored += 1;
      if (hit) accum[h].hits += 1;
      accum[h].sumReturn += expectsUp ? ret : -ret;
    }
  }

  return {
    totalDecisions: closed.length,
    scoredDecisions: Math.max(...horizons.map((h) => accum[h].scored), 0),
    byHorizon: horizons.map((h) => ({
      horizonDays: h,
      totalScored: accum[h].scored,
      hits: accum[h].hits,
      hitRatePct: accum[h].scored > 0 ? (accum[h].hits / accum[h].scored) * 100 : 0,
      avgReturnPct: accum[h].scored > 0 ? (accum[h].sumReturn / accum[h].scored) * 100 : 0,
    })),
  };
}

// ─── Counterfactual on abandoned decisions ────────────────────────────────

export type CounterfactualRow = {
  eventId: string;
  ticker: string;
  action: RecommendedAction;
  firedAt: Date;
  baselinePrice: number;
  currentPrice: number;
  returnPct: number;
  // Estimated dollar impact had the user executed the recommendation. Uses
  // sizingDetails.nominalUsd when present, else null.
  estimatedDollarImpact: number | null;
  notes: string | null;
};

export type CounterfactualResult = {
  rows: CounterfactualRow[];
  totalDollarImpact: number | null;
  message: string;
};

/**
 * For each ABANDONED decision with a ticker, mark to today's price. If the
 * user *would have made money* by following the abandoned recommendation,
 * their discipline cost them; if they *would have lost money*, their
 * discipline saved them. Either way — data.
 */
export async function getCounterfactualOnAbandoned(args: {
  userId: string;
  sinceMonths: number;
}): Promise<CounterfactualResult> {
  const since = new Date(Date.now() - args.sinceMonths * MONTH_MS);
  const abandoned = await prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      outcome: "ABANDONED",
      ticker: { not: null },
      recommendedAction: { in: DIRECTIONAL_ACTIONS },
      outcomeRecordedAt: { gte: since },
    },
    select: {
      id: true,
      ticker: true,
      recommendedAction: true,
      firedAt: true,
      sizingDetails: true,
      outcomeNotes: true,
    },
  });

  const rows: CounterfactualRow[] = [];
  let totalDollar: number | null = null;
  let anyDollar = false;

  for (const ev of abandoned) {
    if (!ev.ticker || !ev.recommendedAction) continue;
    const baseline = await closestCandle(ev.ticker, ev.firedAt, "before");
    const current = await closestCandle(ev.ticker, new Date(), "before");
    if (!baseline || !current) continue;

    const ret = (current.close.toNumber() - baseline.close.toNumber()) / baseline.close.toNumber();
    const expectsUp =
      ev.recommendedAction === "ADD" ||
      ev.recommendedAction === "HOLD_THROUGH_DRAWDOWN";
    // The abandoned-impact convention: positive number = abandoning cost
    // money (you'd have made $X by acting); negative = abandoning saved money.
    const directionalReturn = expectsUp ? ret : -ret;

    const nominalUsd = readNumber(ev.sizingDetails, "nominalUsd");
    let dollarImpact: number | null = null;
    if (nominalUsd != null) {
      dollarImpact = nominalUsd * directionalReturn;
      if (!anyDollar) {
        totalDollar = 0;
        anyDollar = true;
      }
      totalDollar = (totalDollar ?? 0) + dollarImpact;
    }

    rows.push({
      eventId: ev.id,
      ticker: ev.ticker,
      action: ev.recommendedAction,
      firedAt: ev.firedAt,
      baselinePrice: baseline.close.toNumber(),
      currentPrice: current.close.toNumber(),
      returnPct: directionalReturn * 100,
      estimatedDollarImpact: dollarImpact,
      notes: ev.outcomeNotes,
    });
  }

  const message = buildCounterfactualMessage(rows.length, totalDollar);
  return { rows, totalDollarImpact: totalDollar, message };
}

function buildCounterfactualMessage(count: number, totalDollar: number | null): string {
  if (count === 0) return "No abandoned directional decisions in this window — nothing to grade yet.";
  if (totalDollar == null) {
    return `Across ${count} abandoned decision${count === 1 ? "" : "s"}, no sizing data was captured so dollar impact can't be estimated. Future decisions with sizingDetails.nominalUsd populated will fold in.`;
  }
  const sign = totalDollar >= 0 ? "made" : "saved";
  const absDollar = Math.abs(totalDollar);
  return `If you had executed your last ${count} abandoned recommendation${count === 1 ? "" : "s"}, you'd have ${sign} approximately $${absDollar.toFixed(0)} (at recommendation-time sizing).`;
}

// ─── Execution rate by source ─────────────────────────────────────────────

export type ExecutionRateRow = {
  source: AlertSource;
  total: number;
  executed: number;
  abandoned: number;
  rejected: number;
  expired: number;
  executionRatePct: number;
};

export async function getExecutionRate(args: {
  userId: string;
  sinceMonths: number;
}): Promise<ExecutionRateRow[]> {
  const since = new Date(Date.now() - args.sinceMonths * MONTH_MS);
  const closed = await prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      outcome: { not: "OPEN" },
      recommendedAction: { not: null },
      firedAt: { gte: since },
    },
    select: { source: true, outcome: true },
  });

  const bySource = new Map<AlertSource, ExecutionRateRow>();
  for (const ev of closed) {
    const row =
      bySource.get(ev.source) ??
      ({
        source: ev.source,
        total: 0,
        executed: 0,
        abandoned: 0,
        rejected: 0,
        expired: 0,
        executionRatePct: 0,
      } satisfies ExecutionRateRow);
    row.total += 1;
    if (ev.outcome === "EXECUTED_AS_RECOMMENDED" || ev.outcome === "EXECUTED_REVISED") {
      row.executed += 1;
    } else if (ev.outcome === "ABANDONED") row.abandoned += 1;
    else if (ev.outcome === "REJECTED") row.rejected += 1;
    else if (ev.outcome === "EXPIRED") row.expired += 1;
    bySource.set(ev.source, row);
  }
  for (const row of bySource.values()) {
    row.executionRatePct = row.total > 0 ? (row.executed / row.total) * 100 : 0;
  }
  return Array.from(bySource.values()).sort((a, b) => b.total - a.total);
}

// ─── Decision lag ─────────────────────────────────────────────────────────

export type DecisionLagResult = {
  count: number;
  medianHours: number | null;
  p90Hours: number | null;
  meanHours: number | null;
};

export async function getDecisionLag(args: {
  userId: string;
}): Promise<DecisionLagResult> {
  const closed = await prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      outcome: { not: "OPEN" },
      outcomeRecordedAt: { not: null },
      recommendedAction: { not: null },
    },
    select: { firedAt: true, outcomeRecordedAt: true },
  });
  const lagsMs = closed
    .map((e) => (e.outcomeRecordedAt!.getTime() - e.firedAt.getTime()))
    .filter((x) => x >= 0)
    .sort((a, b) => a - b);
  if (lagsMs.length === 0) {
    return { count: 0, medianHours: null, p90Hours: null, meanHours: null };
  }
  const medianMs = lagsMs[Math.floor(lagsMs.length / 2)];
  const p90Ms = lagsMs[Math.min(lagsMs.length - 1, Math.floor(lagsMs.length * 0.9))];
  const meanMs = lagsMs.reduce((s, n) => s + n, 0) / lagsMs.length;
  return {
    count: lagsMs.length,
    medianHours: medianMs / 3_600_000,
    p90Hours: p90Ms / 3_600_000,
    meanHours: meanMs / 3_600_000,
  };
}

// ─── Drift attribution: passive (price moves) vs active (your trades) ─────

export type DriftAttributionRow = {
  category: string;
  targetPct: number;
  actualPct: number; // today
  counterfactualPct: number; // if no trades since `sinceMonths`
  passiveDriftPp: number; // counterfactualPct - targetPct
  activeDriftPp: number; // actualPct - counterfactualPct
  totalDriftPp: number; // actualPct - targetPct
};

export type DriftAttributionResult = {
  available: boolean;
  reason?: string;
  asOf: Date;
  snapshotDate?: Date;
  rows: DriftAttributionRow[];
};

/**
 * Separate IPS bucket drift into:
 *   - passive: drift caused by price movement on the position you held N months ago
 *   - active: drift caused by trades since then
 *
 * Method: pull the closest PortfolioSnapshot from `sinceMonths` ago, mark
 * those holdings to today's prices, allocate to current `tickerCategories`,
 * compare to today's actual bucket weights.
 */
export async function getDriftAttribution(args: {
  userId: string;
  sinceMonths: number;
}): Promise<DriftAttributionResult> {
  const asOf = new Date();
  const target = new Date(asOf.getTime() - args.sinceMonths * MONTH_MS);

  // Closest snapshot at or before target date.
  const baseSnapshot = await prisma.portfolioSnapshot.findFirst({
    where: { userId: args.userId, date: { lte: target } },
    orderBy: { date: "desc" },
  });
  if (!baseSnapshot) {
    return {
      available: false,
      reason: `No portfolio snapshot exists from ${args.sinceMonths} months ago. Drift attribution will activate once snapshots have been running long enough.`,
      asOf,
      rows: [],
    };
  }

  const [ips, portfolio] = await Promise.all([
    getInvestmentPolicy(args.userId),
    getEnrichedPortfolio(args.userId),
  ]);

  // Actual drift today.
  const actual = computeDrift(portfolio.holdings, ips);
  const actualByCategory = new Map<string, number>();
  for (const r of actual.rows) actualByCategory.set(r.category, r.actualPct);
  const totalToday = actual.totalMarketValue;

  // Counterfactual: snapshot holdings marked to today's quotes.
  const baseHoldings = parseSnapshotHoldings(baseSnapshot.holdings);
  // Derive a CAD per-share price from each currently-held position. This
  // covers tickers the user still holds; tickers held in the past but no
  // longer in the portfolio fall through and don't contribute to the
  // counterfactual (acceptable — they're sold-out positions).
  const quotesByTicker = new Map<string, number>();
  for (const h of portfolio.holdings) {
    if (h.marketValueCad != null && h.quantity > 0) {
      quotesByTicker.set(h.ticker, h.marketValueCad / h.quantity);
    }
  }
  let counterfactualTotal = 0;
  const counterfactualByCategory = new Map<string, number>();
  for (const h of baseHoldings) {
    const px = quotesByTicker.get(h.ticker);
    if (px == null) continue; // ticker no longer held + no live quote
    const valueCad = px * h.quantity;
    counterfactualTotal += valueCad;
    const category = ips.tickerCategories[h.ticker];
    if (!category) continue;
    counterfactualByCategory.set(
      category,
      (counterfactualByCategory.get(category) ?? 0) + valueCad,
    );
  }

  const rows: DriftAttributionRow[] = [];
  const categories = new Set<string>([
    ...Object.keys(ips.targetAllocation),
    ...actualByCategory.keys(),
    ...counterfactualByCategory.keys(),
  ]);
  for (const cat of categories) {
    const targetPct = ips.targetAllocation[cat] ?? 0;
    const actualPct = actualByCategory.get(cat) ?? 0;
    const cfValue = counterfactualByCategory.get(cat) ?? 0;
    const counterfactualPct =
      counterfactualTotal > 0 ? (cfValue / counterfactualTotal) * 100 : 0;
    rows.push({
      category: cat,
      targetPct,
      actualPct,
      counterfactualPct,
      passiveDriftPp: counterfactualPct - targetPct,
      activeDriftPp: actualPct - counterfactualPct,
      totalDriftPp: actualPct - targetPct,
    });
  }
  rows.sort((a, b) => Math.abs(b.totalDriftPp) - Math.abs(a.totalDriftPp));

  return {
    available: totalToday > 0 && counterfactualTotal > 0,
    asOf,
    snapshotDate: baseSnapshot.date,
    rows,
  };
}

// ─── Recurring action patterns ────────────────────────────────────────────

export type ActionPattern = {
  kind: "REPEAT_TICKER" | "HIGH_ABANDON_RATE" | "STALE_OPEN";
  severity: "INFO" | "WATCH";
  message: string;
};

export async function getActionPatterns(args: {
  userId: string;
}): Promise<ActionPattern[]> {
  const patterns: ActionPattern[] = [];
  const since = new Date(Date.now() - 6 * MONTH_MS);

  // Pattern 1: same ticker recommended for the same action 3+ times in 6 months.
  const recentDecisions = await prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      ticker: { not: null },
      recommendedAction: { not: null },
      firedAt: { gte: since },
    },
    select: { ticker: true, recommendedAction: true, outcome: true, source: true },
  });
  const byTickerAction = new Map<string, number>();
  for (const ev of recentDecisions) {
    if (!ev.ticker || !ev.recommendedAction) continue;
    const key = `${ev.ticker}::${ev.recommendedAction}`;
    byTickerAction.set(key, (byTickerAction.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byTickerAction) {
    if (count >= 3) {
      const [ticker, action] = key.split("::");
      patterns.push({
        kind: "REPEAT_TICKER",
        severity: "WATCH",
        message: `${ticker} has been recommended for ${action} ${count} times in the last 6 months — anchoring or thesis-grounded? Worth reviewing the rationales side-by-side.`,
      });
    }
  }

  // Pattern 2: very high abandon rate from a single source.
  const closedBySource = new Map<AlertSource, { total: number; abandoned: number }>();
  for (const ev of recentDecisions) {
    if (ev.outcome === "OPEN") continue;
    const row = closedBySource.get(ev.source) ?? { total: 0, abandoned: 0 };
    row.total += 1;
    if (ev.outcome === "ABANDONED") row.abandoned += 1;
    closedBySource.set(ev.source, row);
  }
  for (const [source, { total, abandoned }] of closedBySource) {
    if (total >= 5 && abandoned / total >= 0.7) {
      patterns.push({
        kind: "HIGH_ABANDON_RATE",
        severity: "WATCH",
        message: `${Math.round((abandoned / total) * 100)}% of recommendations from ${source} were abandoned in the last 6 months. Either that source is too noisy or your discipline is filtering well — review the abandonments to tell which.`,
      });
    }
  }

  // Pattern 3: open decisions older than 30 days.
  const staleOpen = await prisma.alertEvent.count({
    where: {
      userId: args.userId,
      outcome: "OPEN",
      recommendedAction: { not: null },
      firedAt: { lte: new Date(Date.now() - 30 * 86_400_000) },
    },
  });
  if (staleOpen > 0) {
    patterns.push({
      kind: "STALE_OPEN",
      severity: "INFO",
      message: `${staleOpen} open decision${staleOpen === 1 ? "" : "s"} older than 30 days. Close them out (even as ABANDONED) so the retrospective stays clean.`,
    });
  }

  return patterns;
}

// ─── Decision history per ticker (for the chat persona) ───────────────────

export type DecisionHistoryRow = {
  eventId: string;
  firedAt: Date;
  ticker: string | null;
  action: RecommendedAction | null;
  source: AlertSource;
  outcome: DecisionOutcome;
  rationale: string | null;
  outcomeNotes: string | null;
};

export async function getDecisionHistoryForTicker(args: {
  userId: string;
  ticker?: string;
  sinceMonths?: number;
  limit?: number;
}): Promise<DecisionHistoryRow[]> {
  const since = args.sinceMonths
    ? new Date(Date.now() - args.sinceMonths * MONTH_MS)
    : undefined;
  const rows = await prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      recommendedAction: { not: null },
      ...(args.ticker ? { ticker: args.ticker.toUpperCase() } : {}),
      ...(since ? { firedAt: { gte: since } } : {}),
    },
    orderBy: { firedAt: "desc" },
    take: args.limit ?? 20,
    select: {
      id: true,
      firedAt: true,
      ticker: true,
      recommendedAction: true,
      source: true,
      outcome: true,
      rationale: true,
      outcomeNotes: true,
    },
  });
  return rows.map((r) => ({
    eventId: r.id,
    firedAt: r.firedAt,
    ticker: r.ticker,
    action: r.recommendedAction,
    source: r.source,
    outcome: r.outcome,
    rationale: r.rationale,
    outcomeNotes: r.outcomeNotes,
  }));
}

// ─── internals ────────────────────────────────────────────────────────────

async function closestCandle(ticker: string, anchor: Date, direction: "before" | "after") {
  if (direction === "before") {
    return prisma.candle.findFirst({
      where: { ticker, ts: { lte: anchor } },
      orderBy: { ts: "desc" },
      select: { ts: true, close: true },
    });
  }
  return prisma.candle.findFirst({
    where: { ticker, ts: { gte: anchor } },
    orderBy: { ts: "asc" },
    select: { ts: true, close: true },
  });
}

type SnapshotHolding = { ticker: string; quantity: number };

function parseSnapshotHoldings(raw: unknown): SnapshotHolding[] {
  if (!Array.isArray(raw)) return [];
  const out: SnapshotHolding[] = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    const obj = h as Record<string, unknown>;
    const ticker = typeof obj.ticker === "string" ? obj.ticker : null;
    const quantity = typeof obj.quantity === "number" ? obj.quantity : Number(obj.quantity);
    if (!ticker || !Number.isFinite(quantity)) continue;
    out.push({ ticker, quantity });
  }
  return out;
}

function readNumber(json: unknown, key: string): number | null {
  if (!json || typeof json !== "object") return null;
  const v = (json as Record<string, unknown>)[key];
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Used by AlertEvent shape callers that want the raw row + computed scoring.
export type _ClosedDecisionMeta = Pick<
  AlertEvent,
  "id" | "ticker" | "recommendedAction" | "firedAt" | "outcome"
>;
