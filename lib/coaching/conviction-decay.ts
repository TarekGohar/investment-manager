import "server-only";
import { prisma } from "@/lib/prisma";
import { createDecisionEvent } from "@/lib/alerts/hub";

const STALE_THRESHOLD_DAYS = 90;
const DECAY_LOOKBACK_DAYS = 180;
const DECAY_FROM_THRESHOLD = 8;
const DECAY_TO_THRESHOLD = 5;

/**
 * Runs as part of the coaching cron pass. Two checks:
 *
 *   1. Stale conviction — any ACTIVE thesis whose conviction was last rated
 *      more than 90 days ago (or never rated) → INFO decision event
 *      suggesting REVIEW_THESIS. This is the periodic re-rate nudge that
 *      keeps held positions from running on enthusiasm that quietly
 *      evaporated 18 months ago.
 *
 *   2. Conviction decay — any ACTIVE thesis whose rating has dropped from
 *      >=8 to <=5 across the last 180 days WITHOUT a corresponding
 *      EXIT / TRIM decision in the same window → MATERIAL event. This is
 *      the classic "I'm holding on past conviction" pattern.
 *
 * Returns the count of events fired for telemetry.
 */
export async function runConvictionDecayWatch(userId: string): Promise<{ fired: number }> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_THRESHOLD_DAYS * 86_400_000);
  const decayCutoff = new Date(now.getTime() - DECAY_LOOKBACK_DAYS * 86_400_000);

  const theses = await prisma.thesis.findMany({
    where: { userId, status: "ACTIVE" },
    select: {
      id: true,
      ticker: true,
      convictionRating: true,
      convictionRatedAt: true,
      convictionHistory: {
        where: { ratedAt: { gte: decayCutoff } },
        orderBy: { ratedAt: "asc" },
        select: { rating: true, ratedAt: true },
      },
    },
  });

  let fired = 0;

  for (const t of theses) {
    // Stale check.
    const isStale =
      t.convictionRatedAt == null || t.convictionRatedAt < staleCutoff;
    if (isStale) {
      // Suppress duplicates: don't fire if a recent unread notification
      // about this ticker's stale conviction already exists.
      const existing = await prisma.alertEvent.findFirst({
        where: {
          userId,
          ticker: t.ticker,
          read: false,
          recommendedAction: null,
          data: { path: ["kind"], equals: "STALE_CONVICTION" },
        },
        select: { id: true },
      });
      if (!existing) {
        await createDecisionEvent({
          userId,
          source: "CRON_RULE",
          rule: "THESIS_INVALIDATION_CANDIDATE", // reuse existing rule as parent
          ticker: t.ticker,
          message: t.convictionRatedAt
            ? `Conviction on ${t.ticker} was last rated ${daysAgo(t.convictionRatedAt, now)} days ago. Re-rate when you're next looking at this name.`
            : `Conviction on ${t.ticker} has never been rated. Set an initial 1-10 score so decay is detectable.`,
          // Notification-only — no recommendedAction. The user can raise a
          // manual decision from the position page if they want to track it.
          urgency: "INFO",
          data: {
            kind: "STALE_CONVICTION",
            lastRatedAt: t.convictionRatedAt?.toISOString() ?? null,
          },
        });
        fired++;
      }
    }

    // Decay check: needs at least one historical rating + a current rating.
    const history = t.convictionHistory;
    if (
      t.convictionRating != null &&
      t.convictionRating <= DECAY_TO_THRESHOLD &&
      history.some((h) => h.rating >= DECAY_FROM_THRESHOLD)
    ) {
      // Did the user TRIM / EXIT in the same window? If so, the decay is
      // already being acted on — don't double-up the alert.
      const acted = await prisma.alertEvent.findFirst({
        where: {
          userId,
          ticker: t.ticker,
          recommendedAction: { in: ["TRIM", "EXIT"] },
          outcome: {
            in: ["EXECUTED_AS_RECOMMENDED", "EXECUTED_REVISED"],
          },
          outcomeRecordedAt: { gte: decayCutoff },
        },
        select: { id: true },
      });
      if (acted) continue;

      const existing = await prisma.alertEvent.findFirst({
        where: {
          userId,
          ticker: t.ticker,
          read: false,
          recommendedAction: null,
          data: { path: ["kind"], equals: "CONVICTION_DECAY" },
        },
        select: { id: true },
      });
      if (existing) continue;

      const peak = Math.max(...history.map((h) => h.rating));
      await createDecisionEvent({
        userId,
        source: "CRON_RULE",
        rule: "THESIS_INVALIDATION_CANDIDATE",
        ticker: t.ticker,
        message: `Conviction on ${t.ticker} dropped from ${peak} to ${t.convictionRating} over the last ${DECAY_LOOKBACK_DAYS} days — and you haven't trimmed or exited. Is the position still consistent with your current conviction?`,
        // MATERIAL notification — no recommendedAction. The implied action
        // (trim, exit, or re-rate higher with justification) depends on what
        // the user concludes. They raise a decision manually if they decide
        // to act, or just re-rate the conviction.
        urgency: "MATERIAL",
        data: {
          kind: "CONVICTION_DECAY",
          currentRating: t.convictionRating,
          peakInWindow: peak,
          ratingsInWindow: history.map((h) => ({
            rating: h.rating,
            ratedAt: h.ratedAt.toISOString().slice(0, 10),
          })),
        },
      });
      fired++;
    }
  }

  return { fired };
}

function daysAgo(then: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}
