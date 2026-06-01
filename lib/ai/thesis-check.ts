import "server-only";
import { getProvider, getModel } from "@/lib/ai";

/**
 * Given a fresh filing summary and a user's written invalidation criteria,
 * judge whether any criterion is now met. Conservative by design — defaults
 * to "not matched" when the filing doesn't speak to the criterion.
 *
 * Returns a strictly-shaped result. If the model emits unparseable output
 * we treat it as "not matched, confidence 0" rather than throwing — better
 * to under-alert than spam the user with false positives.
 */
export type ThesisCheckResult = {
  matched: boolean;
  /** 0–100. Treat ≥ 60 as "fire the alert". */
  confidence: number;
  /** Which specific criterion the model thinks is triggered (verbatim or
   *  paraphrased from the user's text). Null when matched=false. */
  criterionTriggered: string | null;
  /** Short markdown explanation: which line from the filing summary +
   *  which criterion it conflicts with. */
  reasoning: string;
};

const SYSTEM = `You are a sell-side analyst stress-testing a single retail investor's investment thesis against a fresh quarterly filing.

The investor wrote down INVALIDATION CRITERIA — specific, measurable things that would force them to sell the position. You will see those criteria plus the latest AI quarterly read of the company's most recent 10-K / 10-Q / 40-F / 6-K.

Your job: judge whether any of the invalidation criteria are now met by what the filing summary discloses.

Output JSON only, no prose, no markdown fence. Schema:

{
  "matched": boolean,
  "confidence": integer 0-100,
  "criterionTriggered": string | null,
  "reasoning": string
}

Rules:
- Default to matched=false when the filing summary doesn't speak directly to the criterion. Better to under-alert than spam.
- confidence ≥ 60 means you'd send the alert. Use it as a precision threshold, not a recall threshold.
- criterionTriggered must paraphrase the EXACT criterion you think is met, taken from the user's invalidation text.
- reasoning is ≤ 3 sentences. Cite the specific line from the filing summary that triggered the match. If matched=false, briefly say why (the filing didn't address it / addressed it but criterion not met).
- Never invent numbers not in the filing summary.
- No buy/sell language. No price targets. Research, not advice.
- Output the JSON object only, with no leading or trailing characters.`;

export async function checkThesisInvalidation(args: {
  ticker: string;
  invalidationCriteria: string;
  filingSummary: string;
  filingType?: string;
  filedAtIso?: string;
}): Promise<ThesisCheckResult> {
  const userMessage = [
    `Ticker: ${args.ticker}`,
    args.filingType ? `Filing: ${args.filingType}${args.filedAtIso ? ` filed ${args.filedAtIso}` : ""}` : null,
    "",
    "USER'S INVALIDATION CRITERIA:",
    args.invalidationCriteria,
    "",
    "AI QUARTERLY READ OF THE LATEST FILING:",
    args.filingSummary,
    "",
    "Output the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n");

  const provider = getProvider();
  const model = getModel();
  let raw = "";

  try {
    for await (const ev of provider.streamChat({
      model,
      system: SYSTEM,
      messages: [{ role: "user", text: userMessage }],
      tools: [],
      maxToolRounds: 1,
    })) {
      if (ev.type === "text") raw += ev.delta;
      if (ev.type === "error") return safeFallback("model returned an error event");
    }
  } catch (err) {
    return safeFallback(`provider failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return parseResult(raw);
}

function parseResult(raw: string): ThesisCheckResult {
  const trimmed = raw.trim();
  if (!trimmed) return safeFallback("model returned empty output");

  // Be lenient: some models still wrap JSON in code fences despite instructions.
  const jsonText = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return safeFallback("model output wasn't valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    return safeFallback("model output wasn't an object");
  }
  const obj = parsed as Record<string, unknown>;

  const matched = Boolean(obj.matched);
  const confidenceRaw = obj.confidence;
  let confidence = 0;
  if (typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)) {
    confidence = Math.max(0, Math.min(100, Math.round(confidenceRaw)));
  }
  const criterionTriggered =
    typeof obj.criterionTriggered === "string" && obj.criterionTriggered.trim()
      ? obj.criterionTriggered.trim().slice(0, 500)
      : null;
  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim()
      ? obj.reasoning.trim().slice(0, 2000)
      : "No reasoning provided.";

  return {
    matched,
    confidence,
    criterionTriggered,
    reasoning,
  };
}

function safeFallback(reason: string): ThesisCheckResult {
  return {
    matched: false,
    confidence: 0,
    criterionTriggered: null,
    reasoning: `Could not evaluate: ${reason}`,
  };
}
