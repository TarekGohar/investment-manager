import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { getInvestmentPolicy, computeDrift, type AllocationRow } from "@/lib/policy/ips";

/**
 * Rebalance watcher: fires when an IPS category has drifted past the user's
 * threshold AND the breach has been sustained (we don't fire on a single
 * day's noise — the breach must show up in `minConsecutiveDays` of recent
 * EOD snapshots).
 *
 * The alert message names the most-drifted category, current vs target, and
 * suggests a one-leg trim-and-buy plan. The user opens the plan and decides
 * to act; pre-trade guards keep the suggestion sticky.
 *
 * Suppression: skipped if a PlannedAction(kind=REBALANCE, fulfilledAt=null)
 * is already open (the user has stated intent).
 */
export type RebalanceFiredEvent = {
  userId: string;
  ticker: null;
  message: string;
  data: Record<string, unknown>;
};

const DEFAULT_MIN_CONSECUTIVE_DAYS = 3;
const DEFAULT_COOLDOWN_DAYS = 7;

export async function runRebalanceWatch(userId: string): Promise<RebalanceFiredEvent[]> {
  const policy = await getInvestmentPolicy(userId);
  if (policy.driftThresholdPct == null) return [];
  if (Object.keys(policy.targetAllocation).length === 0) return [];

  const portfolio = await getEnrichedPortfolio(userId);
  if (portfolio.holdings.length === 0) return [];

  const drift = computeDrift(portfolio.holdings, policy);
  const breaches = drift.rows.filter((r) => r.exceedsThreshold);
  if (breaches.length === 0) return [];

  // Sustained-breach check via PortfolioSnapshot history. We're being
  // pragmatic — snapshots store byKind + holdings JSON, but recomputing
  // drift from each snapshot is expensive. As a proxy: require an open
  // breach today AND the same category was breached `minConsecutiveDays`
  // ago. If there aren't enough snapshots yet, fire on today's signal only.
  const minDaysAgo = new Date(Date.now() - DEFAULT_MIN_CONSECUTIVE_DAYS * 86_400_000);
  const oldSnap = await prisma.portfolioSnapshot.findFirst({
    where: { userId, date: { lte: minDaysAgo } },
    orderBy: { date: "desc" },
  });
  const oldBreach = oldSnap
    ? wasCategoryBreached(oldSnap, policy, breaches[0].category)
    : true;
  if (!oldBreach) return [];

  // Suppress if user already has an open rebalance plan
  const openPlan = await prisma.plannedAction.findFirst({
    where: { userId, kind: "REBALANCE", fulfilledAt: null, dismissedAt: null },
    select: { id: true },
  });
  if (openPlan) return [];

  // Cooldown — don't re-fire the same category within a week
  const cooldown = new Date(Date.now() - DEFAULT_COOLDOWN_DAYS * 86_400_000);
  const recent = await prisma.alertEvent.findMany({
    where: {
      userId,
      firedAt: { gte: cooldown },
      data: { path: ["rule"], equals: "REBALANCE_DUE" },
    },
    select: { data: true },
  });
  const recentlyFiredCategories = new Set(
    recent
      .map((e) => (e.data as Record<string, unknown>)?.category)
      .filter((c): c is string => typeof c === "string"),
  );

  const events: RebalanceFiredEvent[] = [];
  for (const breach of breaches) {
    if (recentlyFiredCategories.has(breach.category)) continue;
    events.push(formatRebalanceEvent(userId, breach, drift.rows, drift.totalMarketValue));
  }
  return events;
}

function wasCategoryBreached(
  snap: { holdings: unknown },
  policy: { tickerCategories: Record<string, string>; targetAllocation: Record<string, number>; driftThresholdPct: number | null },
  category: string,
): boolean {
  if (policy.driftThresholdPct == null) return false;
  // Snapshot holdings shape: [{ ticker, quantity, costBasis, marketValue }]
  const rows = Array.isArray(snap.holdings) ? snap.holdings : [];
  let categoryValue = 0;
  let totalValue = 0;
  for (const r of rows as Array<Record<string, unknown>>) {
    const ticker = String(r.ticker ?? "");
    const mv = Number(r.marketValue ?? r.costBasis ?? 0);
    if (!Number.isFinite(mv)) continue;
    totalValue += mv;
    if (policy.tickerCategories[ticker] === category) categoryValue += mv;
  }
  if (totalValue <= 0) return false;
  const actualPct = (categoryValue / totalValue) * 100;
  const targetPct = policy.targetAllocation[category] ?? 0;
  return Math.abs(actualPct - targetPct) > policy.driftThresholdPct;
}

function formatRebalanceEvent(
  userId: string,
  breach: AllocationRow,
  allRows: AllocationRow[],
  totalMarketValue: number,
): RebalanceFiredEvent {
  const direction = breach.driftPct > 0 ? "overweight" : "underweight";
  const driftDollars = (Math.abs(breach.driftPct) / 100) * totalMarketValue;

  // Pair the breach with its mirror category (most-opposite drift) for a
  // simple "trim X / buy Y" suggestion. Caller's UI shows the full table.
  const mirror = allRows
    .filter((r) => r.category !== breach.category)
    .filter((r) => Math.sign(r.driftPct) === -Math.sign(breach.driftPct))
    .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))[0];

  // Plan direction depends on whether the breached category is over- or
  // under-weight. Over → trim from it, fund the mirror. Under → buy into
  // it, funded from the mirror (which by construction is the opposite
  // sign of drift).
  const isOverweight = breach.driftPct > 0;
  const plan = mirror
    ? isOverweight
      ? `Suggested: trim ~${fmt(driftDollars)} from ${breach.category} → add to ${mirror.category} (currently ${mirror.actualPct.toFixed(1)}% vs target ${mirror.targetPct.toFixed(1)}%).`
      : `Suggested: add ~${fmt(driftDollars)} to ${breach.category} (funded by trimming ${mirror.category}, currently ${mirror.actualPct.toFixed(1)}% vs target ${mirror.targetPct.toFixed(1)}%).`
    : isOverweight
      ? `Suggested: trim ~${fmt(driftDollars)} from ${breach.category}; no overweight category to fund the trim into (cash will rise).`
      : `Suggested: add ~${fmt(driftDollars)} to ${breach.category}; deploy idle cash or trim a smaller category to fund.`;

  const message =
    `${breach.category} ${direction}: actual ${breach.actualPct.toFixed(1)}% vs target ${breach.targetPct.toFixed(1)}% ` +
    `(${breach.driftPct > 0 ? "+" : ""}${breach.driftPct.toFixed(1)}pp drift). ${plan}`;

  return {
    userId,
    ticker: null,
    message,
    data: {
      rule: "REBALANCE_DUE",
      category: breach.category,
      direction,
      actualPct: breach.actualPct,
      targetPct: breach.targetPct,
      driftPct: breach.driftPct,
      driftDollars,
      totalMarketValue,
      mirrorCategory: mirror?.category ?? null,
      mirrorActualPct: mirror?.actualPct ?? null,
      mirrorTargetPct: mirror?.targetPct ?? null,
    },
  };
}

function fmt(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}
