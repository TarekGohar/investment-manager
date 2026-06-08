/**
 * Investment-committee panel types.
 *
 * The panel runs in isolation: each specialist sees only the brief and its
 * own tools, never another specialist's work. The CIO synthesizes after the
 * panel returns. Memos persist so a deep analysis today informs conversational
 * answers tomorrow without re-firing the panel.
 */

import type { ToolCall } from "@/lib/ai/types";

export type SpecialistName =
  | "BUSINESS_ANALYST"
  | "VALUATION_ANALYST"
  | "MACRO_INDUSTRY"
  | "RISK_PORTFOLIO"
  | "TAX_STRATEGIST"
  | "BEHAVIORAL_COACH"
  | "DEVILS_ADVOCATE"
  | "CAPITAL_ALLOCATOR";

export const ALL_SPECIALISTS: SpecialistName[] = [
  "BUSINESS_ANALYST",
  "VALUATION_ANALYST",
  "MACRO_INDUSTRY",
  "RISK_PORTFOLIO",
  "TAX_STRATEGIST",
  "BEHAVIORAL_COACH",
  "DEVILS_ADVOCATE",
  "CAPITAL_ALLOCATOR",
];

/**
 * Epistemic tag on every claim in a memo. Drives the no-inference-without-facts
 * discipline: every statement must trace to a tag, and [GAP] is a first-class,
 * expected output — it's how the CIO sees what could not be assessed.
 *
 *   FACT  — direct from a source. Cite tool name + call id.
 *   CALC  — arithmetic on facts. Show inputs.
 *   INFER — a conclusion drawn from cited facts. List the supporting facts.
 *   GAP   — data needed but not available.
 */
export type ClaimTag = "FACT" | "CALC" | "INFER" | "GAP";

export type MemoFinding = {
  /** Dimension this addresses, e.g. "Moat", "Capital allocation". */
  dimension: string;
  tag: ClaimTag;
  /** Statement itself. For GAP, describe the missing data. */
  statement: string;
  /**
   * Tool names / call IDs this traces to. Required for FACT / CALC / INFER.
   * For GAP, empty (the source of a gap is its absence).
   */
  sources: string[];
};

/** What the specialist returns via `submit_memo`. */
export type MemoSubmission = {
  /**
   * 1-2 sentences. The literal string "INSUFFICIENT_EVIDENCE" is a valid and
   * often correct conclusion — it must not be smoothed into a false call.
   */
  conclusion: string;
  confidence: "low" | "medium" | "high" | "insufficient";
  findings: MemoFinding[];
  /** Strongest case against the conclusion. Mandatory, even for insufficient. */
  steelmanOpposite: string;
  /** Observable falsifiers. */
  whatWouldFlipMe: string[];
  /** Ordered, most important first. */
  dataGaps: string[];
};

/** Full memo as persisted. */
export type Memo = MemoSubmission & {
  specialist: SpecialistName;
  ticker: string;
  /** ISO timestamp the memo was produced. */
  asOf: string;
  /** Brief the orchestrator handed in. Stored verbatim. */
  brief: string;
  /** Model identifier, for calibration replay. */
  modelUsed: string;
  /** Tool names the specialist actually called during this run. */
  toolsConsulted: string[];
};

/**
 * The CIO's request to convene the panel. The user confirms before the panel
 * fires — calling `request_panel` does NOT itself convene anyone.
 */
export type EscalationRequest = {
  /** Topic in plain English, close to the user's own words. */
  topic: string;
  ticker: string | null;
  /** Why the CIO is escalating instead of answering alone. */
  reason: string;
  /** The CIO's recommended specialists. The orchestrator may refine. */
  recommendedSpecialists: SpecialistName[];
};

export type SpecialistRun = {
  memo: Memo | null;
  /** Set when no memo was submitted (model bailed or stream errored). */
  error?: string;
  /** All tool calls observed during the run, for audit. */
  toolCalls: ToolCall[];
  /**
   * When no memo arrived, the model's trailing text and finish reason help
   * diagnose: hit max_tokens? wrote prose instead of submit_memo? safety cut?
   */
  diagnostic?: {
    finalText: string;
    finishReason?: string;
  };
};
