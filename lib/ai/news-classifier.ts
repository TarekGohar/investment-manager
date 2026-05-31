import "server-only";
import { getModel, getProvider } from "@/lib/ai";
import type { NewsSeverity } from "@/generated/prisma";

const SYSTEM = `You classify financial news headlines by materiality for a long-term equity investor.

Reply with exactly one word, no punctuation:

INFO       — routine coverage, recap, opinion, analyst note, ratings change, broker target tweak, light commentary
MATERIAL   — earnings report, guidance change, major contract or partnership, M&A, executive change, FDA approval/rejection, regulatory action, large insider activity, dividend or buyback change, stock split, secondary offering
CRITICAL   — fraud or accounting scandal, bankruptcy or restructuring, trading halt, large material adverse event, leadership ousted under investigation

Default to INFO unless the headline clearly meets the higher bar. Do not add anything else.`;

/**
 * Classifies a single headline. Returns "INFO" on any failure or parsing
 * ambiguity, since false-positives are worse than false-negatives for alerts.
 */
export async function classifyHeadline({
  ticker,
  headline,
  summary,
}: {
  ticker: string;
  headline: string;
  summary?: string | null;
}): Promise<NewsSeverity> {
  const provider = getProvider();
  const model = getModel();

  const userMessage = `Ticker: ${ticker}\nHeadline: ${headline}${
    summary ? `\nSummary: ${summary.slice(0, 400)}` : ""
  }\n\nClassification:`;

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
      if (ev.type === "error") return "INFO";
    }
  } catch {
    return "INFO";
  }

  const upper = raw.trim().toUpperCase();
  if (upper.includes("CRITICAL")) return "CRITICAL";
  if (upper.includes("MATERIAL")) return "MATERIAL";
  return "INFO";
}
