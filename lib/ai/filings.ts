import "server-only";
import { prisma } from "@/lib/prisma";
import { getModel, getProvider } from "@/lib/ai";
import type { Filing, AnalysisKind } from "@/generated/prisma";

const QUARTERLY_PERSONA = `You are a sell-side equity analyst writing a quarterly read for a single retail investor.
The reader is sophisticated — assume they know what revenue, gross margin, FCF, segment reporting, and guidance language mean. No definitions.

Output 600–900 words of dense markdown. No fluff, no "let me dive in", no closing pleasantries.

Required structure:

### Headline
One paragraph: what the print actually said. Revenue growth direction, margin direction, FCF direction, guidance change. Don't bury the lede.

### What's new
Bulleted list of material changes vs prior period (or vs guidance if comparing to a single quarter). Cite numbers from the filing verbatim — never round to a "feel right" number you imagined.

### Segment / product detail
Walk through the segments or product lines that drove the print. If a segment surprised either way, say why.

### Balance sheet + capital allocation
Share count direction, debt direction, cash position, buybacks/dividends. If management retired debt or raised debt, flag it.

### MD&A signal
Pull 1–2 specific MD&A passages that change the read on the next quarter or two. Quote them briefly. If management is hedging or repeating prior-quarter language verbatim, say so.

### Thesis implications
2–4 bullets. What this print means for the bull case, the bear case, and what would invalidate either.

### What to watch next
2–3 specific items for the next quarter — a segment to track, a metric to clear, a guidance commitment to verify.

Style rules:
- **Bold** ticker mentions and key dollar/percent figures.
- Never invent a number. If a number isn't in the filing text you've been given, say "not disclosed in this filing" rather than guessing.
- Never refer to your own training data for fundamentals — only the text in front of you.
- No buy/sell recommendation. No price targets. Research, not advice.`;

type SummarizeArgs = {
  userId: string;
  ticker: string;
  filing: Filing & { body: string };
  priorFiling?: (Filing & { body: string }) | null;
};

/**
 * Generate a structured quarterly read for one filing. Stores the result as
 * an AIAnalysis row with kind=QUARTERLY_DEEP and metrics linking back to the
 * Filing id. Returns the new analysis id, or null if the model returned
 * nothing usable.
 */
export async function summarizeQuarterly(
  args: SummarizeArgs,
): Promise<string | null> {
  const { userId, ticker, filing, priorFiling } = args;
  const provider = getProvider();
  const model = getModel();

  const userMessage = buildPrompt(ticker, filing, priorFiling ?? null);

  let body = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  for await (const ev of provider.streamChat({
    model,
    system: QUARTERLY_PERSONA,
    messages: [{ role: "user", text: userMessage }],
    tools: [],
    maxToolRounds: 1,
  })) {
    if (ev.type === "text") body += ev.delta;
    if (ev.type === "done" && ev.usage) usage = ev.usage;
    if (ev.type === "error") return null;
  }

  if (!body.trim()) return null;

  const kind: AnalysisKind = "QUARTERLY_DEEP";
  const row = await prisma.aIAnalysis.create({
    data: {
      userId,
      kind,
      ticker,
      title: `${ticker} · ${humanFormType(filing.type)} · ${formatFilingDate(filing.filedAt)}`,
      body: body.trim(),
      metrics: {
        filingId: filing.id,
        filingType: filing.type,
        filingSource: filing.source,
        filedAt: filing.filedAt.toISOString(),
        priorFilingId: priorFiling?.id ?? null,
      },
      model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    },
    select: { id: true },
  });
  return row.id;
}

function buildPrompt(
  ticker: string,
  filing: Filing & { body: string },
  prior: (Filing & { body: string }) | null,
): string {
  const parts: string[] = [];
  parts.push(
    `Ticker: ${ticker}\nFiling: ${humanFormType(filing.type)} filed ${filing.filedAt.toISOString().slice(0, 10)}\nFiling URL: ${filing.url}\n`,
  );
  if (prior) {
    parts.push(
      `Prior filing for comparison: ${humanFormType(prior.type)} filed ${prior.filedAt.toISOString().slice(0, 10)}.\n`,
    );
  }
  parts.push("---\nCURRENT FILING TEXT (truncated):\n");
  parts.push(filing.body);
  if (prior) {
    parts.push("\n---\nPRIOR FILING TEXT (truncated):\n");
    parts.push(prior.body);
  }
  parts.push(
    "\n---\nProduce the quarterly read per the structure in your instructions. Cite numbers verbatim from the text above.",
  );
  return parts.join("\n");
}

function humanFormType(type: Filing["type"]): string {
  switch (type) {
    case "TEN_K":
      return "10-K";
    case "TEN_Q":
      return "10-Q";
    case "EIGHT_K":
      return "8-K";
    case "FORTY_F":
      return "40-F (Canadian annual)";
    case "SIX_K":
      return "6-K (Canadian material)";
    case "TWENTY_F":
      return "20-F";
    case "F_10":
      return "F-10 prospectus";
    case "F_X":
      return "F-X consent";
    case "F_3":
      return "F-3 shelf";
    case "ANNUAL_INFO_FORM":
      return "AIF";
    case "MD_AND_A":
      return "MD&A";
    case "ANNUAL_FINANCIAL_STATEMENTS":
      return "Annual financials";
    case "INTERIM_FINANCIAL_STATEMENTS":
      return "Interim financials";
    case "MATERIAL_CHANGE_REPORT":
      return "Material change";
    default:
      return "Filing";
  }
}

function formatFilingDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export async function getLatestQuarterlyAnalysis(
  userId: string,
  ticker: string,
): Promise<{
  id: string;
  title: string | null;
  body: string;
  generatedAt: Date;
  filingId: string | null;
} | null> {
  const row = await prisma.aIAnalysis.findFirst({
    where: { userId, kind: "QUARTERLY_DEEP", ticker },
    orderBy: { generatedAt: "desc" },
    select: { id: true, title: true, body: true, generatedAt: true, metrics: true },
  });
  if (!row) return null;
  const metrics = row.metrics as { filingId?: string } | null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    generatedAt: row.generatedAt,
    filingId: metrics?.filingId ?? null,
  };
}
