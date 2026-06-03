/**
 * Per-model token pricing in USD per million tokens. Mirrors the rate card
 * each provider publishes — used to compute monthly spend from the token
 * counts we persist on every AI row (since the regular API key doesn't
 * expose a "credits remaining" endpoint).
 *
 * Anthropic billing has three input buckets that price differently:
 *   - `input`         — uncached read (full rate).
 *   - `cachedInput`   — cache read (~10% of full rate).
 *   - `cacheWriteAvg` — cache write. Anthropic charges 1.25× input for the
 *                       5-minute TTL and 2× input for the 1-hour TTL. Our
 *                       provider uses BOTH (system + tools = 1h, last
 *                       message = 5min), and the API returns one combined
 *                       `cache_creation_input_tokens` figure that doesn't
 *                       distinguish the TTL. We use a 1.5× blended average
 *                       — close enough that monthly totals land within a
 *                       few percent of the Anthropic console.
 *
 * When a model id doesn't match any rule, falls through to `UNKNOWN_RATE`
 * (conservative — assumes Opus pricing so we don't lowball costs in the UI).
 */

export type ModelRate = {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-read tokens. Defaults to 10% of input if omitted. */
  cachedInput?: number;
  /** USD per million cache-write tokens. Defaults to 1.5× input (blended TTL). */
  cacheWriteAvg?: number;
};

const RULES: Array<{ match: (m: string) => boolean; rate: ModelRate; family: string }> = [
  // ─── Anthropic ─────────────────────────────────────────────────────
  // Opus 4.7 and 4.8 standard pricing is $5 / $25 per Mtok. Earlier 4.x
  // generations were $15 / $75 — if a caller pins to e.g. claude-opus-4-1,
  // they'll be priced at the lower rate here. That's intentionally generous
  // for legacy IDs; if the over/under matters, add a specific entry above
  // this catch-all.
  {
    family: "claude-opus-4",
    match: (m) => /claude-opus-4/i.test(m),
    rate: { input: 5, output: 25, cachedInput: 0.5, cacheWriteAvg: 7.5 },
  },
  {
    family: "claude-sonnet-4",
    match: (m) => /claude-sonnet-4/i.test(m),
    rate: { input: 3, output: 15, cachedInput: 0.3, cacheWriteAvg: 4.5 },
  },
  {
    family: "claude-haiku-4",
    match: (m) => /claude-haiku-4/i.test(m),
    rate: { input: 1, output: 5, cachedInput: 0.1, cacheWriteAvg: 1.5 },
  },
  {
    family: "claude-haiku-3",
    match: (m) => /claude-(3-5-haiku|haiku-3)/i.test(m),
    rate: { input: 0.8, output: 4, cachedInput: 0.08, cacheWriteAvg: 1.2 },
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

const UNKNOWN_RATE: ModelRate = { input: 5, output: 25, cachedInput: 0.5, cacheWriteAvg: 7.5 };

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

/**
 * USD cost given a model id and per-bucket token counts. `inputTokens` is
 * the *uncached* portion (full rate); cached + cacheCreation are priced
 * separately. Legacy rows that predate the cache columns will pass them
 * as 0 / undefined and the math collapses to input + output, which is
 * what we always did before.
 */
export function computeCostUsd(args: {
  model: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
}): number {
  const r = rateFor(args.model);
  const cachedRate = r.cachedInput ?? r.input * 0.1;
  const cacheWriteRate = r.cacheWriteAvg ?? r.input * 1.5;
  return (
    (args.inputTokens / 1_000_000) * r.input +
    ((args.cachedTokens ?? 0) / 1_000_000) * cachedRate +
    ((args.cacheCreationTokens ?? 0) / 1_000_000) * cacheWriteRate +
    (args.outputTokens / 1_000_000) * r.output
  );
}
