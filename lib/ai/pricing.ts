/**
 * Per-model token pricing in USD per million tokens. We track our own spend
 * because Anthropic / OpenAI don't expose a real-time "credits remaining"
 * endpoint on the regular API key. As long as the model id we persist on
 * each AI row matches one of these keys (case-insensitive, prefix match),
 * we can compute USD spent locally.
 *
 * When a model id doesn't match any rule, falls through to `UNKNOWN_RATE`
 * (conservative — assumes Opus pricing so we don't lowball costs in the UI).
 *
 * Cached-read pricing is informational only — we don't yet persist a
 * `cachedTokens` column, so the computed cost slightly OVER-counts on
 * Anthropic cache hits. That's the safer direction for a "burn rate" tile.
 */

export type ModelRate = {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cached-read input tokens. Informational only. */
  cachedInput?: number;
};

const RULES: Array<{ match: (m: string) => boolean; rate: ModelRate; family: string }> = [
  // ─── Anthropic ─────────────────────────────────────────────────────
  {
    family: "claude-opus-4",
    match: (m) => /claude-opus-4/i.test(m),
    rate: { input: 15, output: 75, cachedInput: 1.5 },
  },
  {
    family: "claude-sonnet-4",
    match: (m) => /claude-sonnet-4/i.test(m),
    rate: { input: 3, output: 15, cachedInput: 0.3 },
  },
  {
    family: "claude-haiku-4",
    match: (m) => /claude-haiku-4/i.test(m),
    rate: { input: 0.8, output: 4, cachedInput: 0.08 },
  },
  {
    family: "claude-haiku-3",
    match: (m) => /claude-(3-5-haiku|haiku-3)/i.test(m),
    rate: { input: 0.8, output: 4 },
  },
  // ─── OpenAI / Azure OpenAI ─────────────────────────────────────────
  {
    family: "gpt-4o",
    match: (m) => /^(gpt-4o|gpt4o)(?!.*mini)/i.test(m),
    rate: { input: 2.5, output: 10 },
  },
  {
    family: "gpt-4o-mini",
    match: (m) => /gpt-4o.?mini/i.test(m),
    rate: { input: 0.15, output: 0.6 },
  },
  {
    family: "o1-mini",
    match: (m) => /o1.?mini/i.test(m),
    rate: { input: 1.1, output: 4.4 },
  },
  {
    family: "o1",
    match: (m) => /^o1(?!.*mini)/i.test(m),
    rate: { input: 15, output: 60 },
  },
];

const UNKNOWN_RATE: ModelRate = { input: 15, output: 75 };

export function rateFor(model: string | null | undefined): ModelRate {
  if (!model) return UNKNOWN_RATE;
  for (const r of RULES) {
    if (r.match(model)) return r.rate;
  }
  return UNKNOWN_RATE;
}

export function familyFor(model: string | null | undefined): string {
  if (!model) return "unknown";
  for (const r of RULES) {
    if (r.match(model)) return r.family;
  }
  return model;
}

/** USD cost given a model id and token counts. */
export function computeCostUsd(args: {
  model: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
}): number {
  const r = rateFor(args.model);
  return (args.inputTokens / 1_000_000) * r.input + (args.outputTokens / 1_000_000) * r.output;
}
