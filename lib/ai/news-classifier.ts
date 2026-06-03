import "server-only";
import { getModel, getProvider } from "@/lib/ai";
import type { NewsSeverity } from "@/generated/prisma";

const SYSTEM = `You classify financial news headlines by materiality for a long-term equity investor.

Categories (output one per item, exact spelling):
INFO       — routine coverage, recap, opinion, analyst note, ratings change, broker target tweak, light commentary
MATERIAL   — earnings report, guidance change, major contract or partnership, M&A, executive change, FDA approval/rejection, regulatory action, large insider activity, dividend or buyback change, stock split, secondary offering
CRITICAL   — fraud or accounting scandal, bankruptcy or restructuring, trading halt, large material adverse event, leadership ousted under investigation

Calibration rules:
- Default to INFO unless the headline clearly meets the higher bar.
- For mega-caps (Apple, Microsoft, Amazon, Nvidia, Google, Tesla, Berkshire) be MORE conservative — many things that are "MATERIAL" for a small-cap are routine for a mega-cap.
- A re-write of the same story (same ticker, same fact, within 24 hours of an earlier item you already saw) is INFO, not MATERIAL. Materiality belongs to the underlying event, not to each wire pickup.
- Source quality matters: Reuters/Bloomberg/BNN/CP/Globe and Mail are higher signal than aggregators or opinion blogs.

Output format: JSON array, one object per input item, in the same order:
[{"i": 0, "severity": "INFO"}, {"i": 1, "severity": "MATERIAL"}, ...]
Output the JSON array only. No prose, no markdown fences.`;

type BatchItem = {
  ticker: string;
  headline: string;
  summary?: string | null;
  source?: string | null;
  publishedAt?: Date | null;
};

/**
 * Batch-classify up to 20 headlines per model call. Falls back to INFO for
 * any item we can't parse — false negatives are cheaper than false positives
 * here. Order of output matches order of input; missing entries default to
 * INFO.
 */
export async function classifyHeadlines(
  items: BatchItem[],
): Promise<NewsSeverity[]> {
  if (items.length === 0) return [];
  const provider = getProvider();
  const model = getModel();

  const lines: string[] = [];
  items.forEach((item, i) => {
    const parts = [`i=${i}`, `ticker=${item.ticker}`];
    if (item.source) parts.push(`source=${item.source}`);
    if (item.publishedAt) {
      parts.push(`published=${item.publishedAt.toISOString().slice(0, 16)}Z`);
    }
    lines.push(parts.join(" "));
    lines.push(`  headline: ${item.headline}`);
    if (item.summary) lines.push(`  summary: ${item.summary.slice(0, 300)}`);
  });
  const userMessage = `Classify each item below. Output the JSON array now.\n\n${lines.join("\n")}`;

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
      if (ev.type === "error") return items.map(() => "INFO");
    }
  } catch {
    return items.map(() => "INFO");
  }

  return parseSeverities(raw, items.length);
}

/**
 * Single-headline classifier preserved for callers that don't have a batch
 * to send. Just delegates to the batched form.
 */
export async function classifyHeadline(args: {
  ticker: string;
  headline: string;
  summary?: string | null;
  source?: string | null;
  publishedAt?: Date | null;
}): Promise<NewsSeverity> {
  const [result] = await classifyHeadlines([args]);
  return result ?? "INFO";
}

function parseSeverities(raw: string, expectedCount: number): NewsSeverity[] {
  const out: NewsSeverity[] = Array.from({ length: expectedCount }, () => "INFO");
  if (!raw.trim()) return out;
  const stripped = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const idx = typeof obj.i === "number" ? obj.i : Number(obj.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= expectedCount) continue;
    const sev = typeof obj.severity === "string" ? obj.severity.toUpperCase() : "";
    if (sev === "CRITICAL") out[idx] = "CRITICAL";
    else if (sev === "MATERIAL") out[idx] = "MATERIAL";
    else out[idx] = "INFO";
  }
  return out;
}
