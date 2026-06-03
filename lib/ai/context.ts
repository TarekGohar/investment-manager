/**
 * Shared AI-prompting helpers. The point of this module is to give every
 * persona a consistent way to say *when* the data it's reasoning over was
 * captured, and to feed in its own previous output so consecutive runs can
 * build on each other instead of restarting from amnesia.
 *
 * Three artifacts:
 *   - `HOUSE_STYLE`     prefixed onto every persona — collapses duplicate
 *                       style rules (no AI tics, verbatim numbers, etc.).
 *   - `currentContext`  produces the dated "you are here, this is fresh"
 *                       header that gets prepended to every user message.
 *   - `formatAge`       human-friendly relative age ("12 days ago").
 */

export const HOUSE_STYLE = `House style (applies to all responses):
- Use numbers verbatim from the data given to you. Never round to a "feels right" value, never substitute a number from training data.
- No "as an AI", no "I'd be happy to", no closing pleasantries unless there's a genuine next step.
- Plain English first, technical term in parens: "your average buying price (called ACB)" not "ACB". After the first mention in this conversation, the bare term is fine.
- **Bold** ticker mentions and key $ / % figures.
- When a data field is null or missing, say so plainly — never substitute a default. Point the user at the relevant Settings page.`;

export type Freshness = {
  /** Human label, e.g. "latest filing", "portfolio snapshot". */
  label: string;
  /** When the data was produced. Null means "unknown / not available". */
  at: Date | null;
};

export type PriorAnalysis = {
  /** Human label, e.g. "your last quarterly read", "yesterday's daily review". */
  label: string;
  body: string;
  generatedAt: Date;
};

/**
 * Builds the dated context block prepended to every user message. Encodes
 * three signals the model otherwise lacks:
 *   1. Today's date (so "recent" / "this quarter" have grounding).
 *   2. Age of each input (so the model can hedge stale claims).
 *   3. The model's own prior opinion (so it can compare / continue).
 */
export function currentContext(args: {
  today?: Date;
  freshness?: Freshness[];
  priorAnalysis?: PriorAnalysis | null;
}): string {
  const today = args.today ?? new Date();
  const lines: string[] = [];
  lines.push(`Today: ${formatDate(today)} (UTC).`);
  if (args.freshness && args.freshness.length > 0) {
    for (const f of args.freshness) {
      if (!f.at) {
        lines.push(`${f.label}: not available.`);
      } else {
        lines.push(`${f.label}: ${formatDate(f.at)} — ${formatAge(f.at, today)}.`);
      }
    }
  }
  if (args.priorAnalysis) {
    lines.push("");
    lines.push(
      `--- ${args.priorAnalysis.label.toUpperCase()} (${formatAge(args.priorAnalysis.generatedAt, today)}) ---`,
    );
    lines.push(args.priorAnalysis.body);
    lines.push("--- END PRIOR ---");
  }
  return lines.join("\n");
}

export function formatAge(then: Date, now: Date = new Date()): string {
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return "in the future";
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "about a month ago";
  if (months < 12) return `about ${months} months ago`;
  const years = (days / 365).toFixed(1);
  return `${years} years ago`;
}

export function ageInDays(then: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Personas that produce long-form analysis support a "this run isn't useful"
 * exit. When the model decides nothing material has changed, it emits this
 * exact token and the caller skips persisting a new analysis. The literal
 * is treated as case-insensitive when checked downstream.
 */
export const NO_REVIEW_SENTINEL = "NO_REVIEW_NEEDED";

export function isNoReviewSentinel(body: string): boolean {
  const cleaned = body.trim().toUpperCase();
  // Accept the bare sentinel, or a sentence-leading match (some models prepend
  // a short justification before the token).
  return cleaned === NO_REVIEW_SENTINEL || cleaned.startsWith(NO_REVIEW_SENTINEL);
}
