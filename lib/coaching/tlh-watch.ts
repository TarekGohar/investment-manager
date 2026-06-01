import "server-only";
import { prisma } from "@/lib/prisma";
import { findTlhCandidates, type TlhCandidate } from "@/lib/canadian/tlh";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { listTransactions } from "@/lib/portfolio/queries";
import { getUserPreferences } from "@/lib/preferences";
import { formatCurrency, formatPercent } from "@/lib/format";

/**
 * TLH watcher: surfaces tax-loss-harvest opportunities the user might want
 * to act on. Pure advisor — registers a PlannedAction only when the user
 * clicks the email's "mark as planned" link or the in-app equivalent.
 *
 * What qualifies as a candidate (after the underlying findTlhCandidates):
 *   - Non-reg holding with at least `minLoss` of unrealized loss
 *   - No PlannedAction(kind=TLH_HARVEST, ticker, fulfilledAt=null, dismissedAt=null) open
 *   - No fired-and-not-dismissed TLH_OPPORTUNITY alertEvent in the last
 *     `cooldownDays` for the same ticker (avoid re-pestering)
 *
 * Returns the events that should fire — caller persists them and routes
 * email if applicable.
 */
export type TlhFiredEvent = {
  userId: string;
  ticker: string;
  message: string;
  data: Record<string, unknown>;
};

const DEFAULT_MIN_LOSS_CAD = 250;
const DEFAULT_COOLDOWN_DAYS = 14;

export async function runTlhWatch(userId: string): Promise<TlhFiredEvent[]> {
  const prefs = await getUserPreferences(userId);
  const capGainsRate = prefs.taxProfile.marginalCapGainsRate ?? null;

  const [portfolio, transactions] = await Promise.all([
    getEnrichedPortfolio(userId),
    listTransactions(userId),
  ]);
  if (portfolio.holdings.length === 0) return [];

  const candidates = findTlhCandidates({
    holdings: portfolio.holdings,
    transactions,
    minLoss: DEFAULT_MIN_LOSS_CAD,
    capGainsRate,
  });
  if (candidates.length === 0) return [];

  // Suppress tickers with an open plan (user already intends to act)
  const openPlans = await prisma.plannedAction.findMany({
    where: {
      userId,
      kind: "TLH_HARVEST",
      fulfilledAt: null,
      dismissedAt: null,
    },
    select: { ticker: true },
  });
  const planSuppressed = new Set(openPlans.map((p) => p.ticker).filter((t): t is string => !!t));

  // Suppress tickers we already fired on recently (cooldown)
  const cutoff = new Date(Date.now() - DEFAULT_COOLDOWN_DAYS * 86_400_000);
  const recentEvents = await prisma.alertEvent.findMany({
    where: {
      userId,
      firedAt: { gte: cutoff },
      data: { path: ["rule"], equals: "TLH_OPPORTUNITY" },
    },
    select: { ticker: true },
  });
  const cooldownSuppressed = new Set(
    recentEvents.map((e) => e.ticker).filter((t): t is string => !!t),
  );

  const events: TlhFiredEvent[] = [];
  for (const c of candidates) {
    if (planSuppressed.has(c.ticker)) continue;
    if (cooldownSuppressed.has(c.ticker)) continue;
    events.push(formatTlhEvent(userId, c));
  }
  return events;
}

function formatTlhEvent(userId: string, c: TlhCandidate): TlhFiredEvent {
  const lossSize = Math.abs(c.unrealizedLoss);
  const lossPct = c.acb > 0 ? (c.unrealizedLoss / (c.acb * c.nonRegQuantity)) * 100 : 0;
  const replacement = c.replacements[0];
  const savingNote =
    c.estimatedTaxSaving != null
      ? `est. tax saving ${formatCurrency(c.estimatedTaxSaving)}`
      : `set your marginal cap-gains rate to see the estimated saving`;
  const replacementNote = replacement
    ? `Replacement candidate: ${replacement.ticker} (${replacement.label})`
    : `No replacement-ETF candidate on file — buying the same ticker within 30 days violates the superficial-loss rule.`;
  const message =
    `Harvest candidate: ${c.ticker} is ${formatPercent(lossPct)} below ACB ` +
    `(${formatCurrency(lossSize)} unrealized loss, ${savingNote}). ${replacementNote}`;
  return {
    userId,
    ticker: c.ticker,
    message,
    data: {
      rule: "TLH_OPPORTUNITY",
      ticker: c.ticker,
      unrealizedLoss: c.unrealizedLoss,
      lossPct,
      acb: c.acb,
      currentPrice: c.currentPrice,
      nonRegQuantity: c.nonRegQuantity,
      estimatedTaxSaving: c.estimatedTaxSaving,
      replacementTicker: replacement?.ticker ?? null,
      replacementLabel: replacement?.label ?? null,
      hasActiveWindow: c.hasActiveWindow,
      earliestBuybackDate: c.earliestBuybackDate,
    },
  };
}
