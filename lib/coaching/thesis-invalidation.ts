import "server-only";
import { prisma } from "@/lib/prisma";
import { checkThesisInvalidation } from "@/lib/ai/thesis-check";

/**
 * Confidence threshold to convert a thesis-check into a fired alert. Set
 * conservatively so we under-alert rather than spam. The model is
 * instructed to use ≥ 60 as the "I'd send this" threshold.
 */
const FIRE_CONFIDENCE_THRESHOLD = 60;

export type ThesisInvalidationFiredEvent = {
  userId: string;
  ticker: string;
  message: string;
  data: Record<string, unknown>;
};

/**
 * Called from the pull-filings cron right after a fresh quarterly summary
 * lands. Runs `checkThesisInvalidation` for every user holding this ticker
 * with an ACTIVE thesis that includes invalidation criteria. Persists
 * confidence + reasoning to the Thesis row regardless of whether the alert
 * fires (so the user can see "we checked, nothing tripped").
 *
 * Returns the events that should fire — caller writes them through the
 * shared system-alert pipe.
 */
export async function runThesisInvalidationCheck(args: {
  ticker: string;
  filingSummary: string;
  filingType: string;
  filedAt: Date;
}): Promise<ThesisInvalidationFiredEvent[]> {
  const ticker = args.ticker.toUpperCase();

  // Theses that should be checked: ACTIVE or TRIMMED, with non-empty
  // invalidation criteria. EXITED/INVALIDATED positions are out — no point
  // double-flagging an already-broken thesis.
  const theses = await prisma.thesis.findMany({
    where: {
      ticker,
      status: { in: ["ACTIVE", "TRIMMED"] },
      invalidationCriteria: { not: null },
    },
  });
  if (theses.length === 0) return [];

  const events: ThesisInvalidationFiredEvent[] = [];
  const filedAtIso = args.filedAt.toISOString().slice(0, 10);

  for (const thesis of theses) {
    if (!thesis.invalidationCriteria || thesis.invalidationCriteria.trim().length < 5) {
      continue;
    }

    let result;
    try {
      const priorChecks =
        thesis.lastInvalidationCheckAt &&
        thesis.lastInvalidationConfidence != null
          ? [
              {
                at: thesis.lastInvalidationCheckAt,
                confidence: thesis.lastInvalidationConfidence,
                reasoning: thesis.lastInvalidationReasoning ?? "",
              },
            ]
          : undefined;
      result = await checkThesisInvalidation({
        ticker,
        invalidationCriteria: thesis.invalidationCriteria,
        filingSummary: args.filingSummary,
        filingType: args.filingType,
        filedAtIso,
        priorChecks,
      });
    } catch (err) {
      console.error(`[thesis-check] ${thesis.userId}:${ticker} failed:`, err);
      continue;
    }

    // Persist the verdict regardless of whether we fire.
    await prisma.thesis.update({
      where: { id: thesis.id },
      data: {
        lastInvalidationCheckAt: new Date(),
        lastInvalidationConfidence: result.confidence,
        lastInvalidationReasoning: result.reasoning,
      },
    });

    if (!result.matched || result.confidence < FIRE_CONFIDENCE_THRESHOLD) continue;

    // Plain English. The criterionTriggered text is already in the user's
    // own words (we parroted it from their thesis), so quoting it back
    // reminds them this isn't a generic flag — it's the line THEY wrote.
    const criterionSnippet = result.criterionTriggered
      ? `“${result.criterionTriggered.slice(0, 160)}”`
      : "one of the conditions you wrote down";
    const message =
      `${ticker}'s latest financial report just came out, and it might hit ` +
      `the condition you wrote in your investment plan that would make you ` +
      `want to sell: ${criterionSnippet}. The platform is ` +
      `${result.confidence}% confident — worth taking 5 minutes to re-read ` +
      `your thinking on this stock and decide whether to keep holding it.`;

    events.push({
      userId: thesis.userId,
      ticker,
      message,
      data: {
        rule: "THESIS_INVALIDATION_CANDIDATE",
        ticker,
        thesisId: thesis.id,
        confidence: result.confidence,
        criterion: result.criterionTriggered,
        reasoning: result.reasoning,
        filingType: args.filingType,
        filedAt: filedAtIso,
      },
    });
  }

  return events;
}
