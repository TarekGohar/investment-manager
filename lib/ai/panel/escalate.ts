import "server-only";
import { runBusinessAnalyst } from "./business-analyst";
import { runValuationAnalyst } from "./valuation-analyst";
import { runRiskPortfolio } from "./risk-portfolio";
import { runTaxStrategist } from "./tax-strategist";
import { runBehavioralCoach } from "./behavioral-coach";
import { runMacroIndustry } from "./macro-industry";
import { runDevilsAdvocate } from "./devils-advocate";
import { runCapitalAllocator } from "./capital-allocator";
import type { EscalationRequest, Memo, SpecialistName, SpecialistRun } from "./types";
import type { SpecialistMemoStore } from "./persistence";

/**
 * Orchestrator: fires the specialists named in an escalation request in
 * PARALLEL (they're isolated by design — no shared context, no ordering),
 * persists their memos, and returns them. The caller then feeds the memos
 * into `streamCioSynthesis` for the final synthesized reply.
 *
 * This is the entry point the chat surface calls AFTER the user has
 * confirmed an escalation. It does not itself prompt the user.
 */
export async function runPanel(args: {
  userId: string;
  request: EscalationRequest;
  /** The brief sent to each specialist. The CIO's job to compose this well. */
  brief: string;
  store: SpecialistMemoStore;
  signal?: AbortSignal;
  /** Fires when each specialist task starts. Specialists run in parallel,
   *  so most starts arrive within a few ms of each other — useful only to
   *  populate a UI list with statuses. */
  onSpecialistStarted?: (specialist: SpecialistName) => void;
  /** Fires when each specialist resolves, success or error. `durationMs`
   *  measures wall-clock from runPanel entry to this specialist's resolve. */
  onSpecialistCompleted?: (info: {
    specialist: SpecialistName;
    success: boolean;
    durationMs: number;
    error?: string;
  }) => void;
}): Promise<{
  memos: Memo[];
  errors: Array<{ specialist: SpecialistName; error: string }>;
}> {
  const t0 = Date.now();
  const tasks = args.request.recommendedSpecialists.map(async (specialist) => {
    args.onSpecialistStarted?.(specialist);
    const run = await runOneSpecialist({
      specialist,
      userId: args.userId,
      ticker: args.request.ticker ?? "",
      brief: args.brief,
      signal: args.signal,
    });
    if (run.memo) {
      await args.store.save(args.userId, run.memo);
    }
    args.onSpecialistCompleted?.({
      specialist,
      success: run.memo !== null,
      durationMs: Date.now() - t0,
      error: run.error,
    });
    return { specialist, run };
  });

  const results = await Promise.all(tasks);
  const memos: Memo[] = [];
  const errors: Array<{ specialist: SpecialistName; error: string }> = [];
  for (const { specialist, run } of results) {
    if (run.memo) memos.push(run.memo);
    else errors.push({ specialist, error: run.error ?? "Unknown error." });
  }
  return { memos, errors };
}

/**
 * Dispatch to the right specialist. Only Business Analyst is implemented here
 * as the reference; the other seven follow the same shape — a system prompt
 * grounded in multi-mentor methodology, a curated tool subset, and a
 * `submit_memo` terminal action.
 */
async function runOneSpecialist(args: {
  specialist: SpecialistName;
  userId: string;
  ticker: string;
  brief: string;
  signal?: AbortSignal;
}): Promise<SpecialistRun> {
  switch (args.specialist) {
    case "BUSINESS_ANALYST":
      return runBusinessAnalyst({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
    case "VALUATION_ANALYST":
      return runValuationAnalyst({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
    case "RISK_PORTFOLIO":
      return runRiskPortfolio({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
    case "TAX_STRATEGIST":
      return runTaxStrategist({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
    case "BEHAVIORAL_COACH":
      return runBehavioralCoach({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
    case "MACRO_INDUSTRY":
      return runMacroIndustry({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
    case "DEVILS_ADVOCATE":
      return runDevilsAdvocate({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
    case "CAPITAL_ALLOCATOR":
      return runCapitalAllocator({
        userId: args.userId,
        ticker: args.ticker,
        brief: args.brief,
        signal: args.signal,
      });
  }
}
