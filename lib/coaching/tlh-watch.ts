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
  // Decision-grade fields — TLH events graduate to Hub decisions with
  // HARVEST_LOSS action and full sizing rationale.
  recommendedAction: "HARVEST_LOSS";
  urgency: "MATERIAL" | "URGENT";
  rationale: string;
  actionDetails: Record<string, unknown>;
  supportingEvidence: Record<string, unknown>;
  invalidationTrigger: string;
  reviewByDate: Date | null;
  reviewEvent: string | null;
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

  // Plain-English: "you bought X for $Y, it's now worth $Z, you could
  // sell it to claim a tax loss and buy something similar instead."
  // The "average buying price (called ACB)" pattern teaches vocabulary.
  const savingNote =
    c.estimatedTaxSaving != null
      ? `If you sold now, you'd save roughly ${formatCurrency(c.estimatedTaxSaving)} on your taxes.`
      : `To see how much you'd save in taxes, add your marginal capital-gains rate in Settings → Tax profile.`;

  const replacementNote = replacement
    ? `If you want to keep exposure to this kind of investment, you could buy ${replacement.ticker} (${replacement.label}) instead — it's similar enough but counts as a different security for tax purposes, so you can claim the loss.`
    : `Be careful: if you buy ${c.ticker} back within 30 days you can't claim the loss (a CRA rule called the "superficial loss rule"). You'd need a similar-but-not-identical ETF to replace it.`;

  const message =
    `Your ${c.ticker} shares are worth ${Math.abs(lossPct).toFixed(0)}% less than your average buying price (called your ACB). ` +
    `That's a ${formatCurrency(lossSize)} unrealized loss. Selling those shares would turn that paper loss into a real one you could use to lower your tax bill — this is called "tax-loss harvesting". ` +
    `${savingNote} ${replacementNote}`;
  // Urgency: URGENT if tax-year is within 30 days; MATERIAL otherwise.
  const now = new Date();
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  const daysToYearEnd = Math.ceil((yearEnd.getTime() - now.getTime()) / 86_400_000);
  const urgency: "MATERIAL" | "URGENT" = daysToYearEnd <= 30 ? "URGENT" : "MATERIAL";

  const rationale =
    c.estimatedTaxSaving != null
      ? `Crystallizable loss of ${formatCurrency(lossSize)} in a non-registered account. Estimated tax saving ${formatCurrency(c.estimatedTaxSaving)} at your marginal cap-gains rate. No active superficial-loss window on this ticker.`
      : `Crystallizable loss of ${formatCurrency(lossSize)} in a non-registered account. Tax saving depends on marginal rate (set in Tax profile). No active superficial-loss window on this ticker.`;

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
    recommendedAction: "HARVEST_LOSS",
    urgency,
    rationale,
    actionDetails: {
      ticker: c.ticker,
      quantity: c.nonRegQuantity,
      account: "NON_REGISTERED",
      replacementTicker: replacement?.ticker ?? null,
      replacementLabel: replacement?.label ?? null,
    },
    supportingEvidence: {
      unrealizedLossCad: lossSize,
      lossPct,
      acb: c.acb,
      currentPrice: c.currentPrice,
      nonRegQuantity: c.nonRegQuantity,
      estimatedTaxSavingCad: c.estimatedTaxSaving,
    },
    invalidationTrigger: `${c.ticker} (or an identical security) is bought within 30 days of the sale by you or an affiliated person — triggering CRA's superficial-loss rule and disallowing the loss (added to the replacement's ACB instead).`,
    reviewByDate: yearEnd,
    reviewEvent: "Tax year-end",
  };
}
