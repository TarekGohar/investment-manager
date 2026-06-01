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
      result = await checkThesisInvalidation({
        ticker,
        invalidationCriteria: thesis.invalidationCriteria,
        filingSummary: args.filingSummary,
        filingType: args.filingType,
        filedAtIso,
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

    const criterionSnippet = result.criterionTriggered
      ? `“${result.criterionTriggered.slice(0, 120)}”`
      : "your invalidation criteria";
    const message =
      `${ticker}: latest filing summary may meet ${criterionSnippet} ` +
      `(${result.confidence}% confidence). ` +
      `Re-check the thesis on the position page.`;

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
