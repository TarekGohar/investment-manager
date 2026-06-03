import "server-only";
import { prisma } from "@/lib/prisma";
import { getModel, getProvider } from "@/lib/ai";
import { HOUSE_STYLE, currentContext } from "@/lib/ai/context";
import type { Filing, AnalysisKind } from "@/generated/prisma";

/**
 * Persona for the heavyweight annual / quarterly read. Long-form, structured.
 * Used for 10-K, 10-Q, 40-F, 6-K, MD&A, Annual / Interim financials.
 */
const PERIODIC_PERSONA = `${HOUSE_STYLE}

You are a sell-side equity analyst writing a periodic read for a single retail investor whose long-term thesis you'll be given.

Output 600–900 words of dense markdown for a 10-Q / interim filing, 900–1400 words for a 10-K / annual / 40-F. No fluff, no "let me dive in", no closing pleasantries.

Required structure:

### Headline
One paragraph: what the print actually said. Revenue growth direction, margin direction, FCF direction, guidance change. Don't bury the lede.

### What's new
Bullets of material changes vs the prior period (or vs guidance). Cite numbers verbatim from the filing — never round to a "feel right" number.

### Versus last time
If a PRIOR ANALYSIS block is included in context, grade its "what to watch next" items: did each one resolve, deteriorate, or remain open? Be specific. If no prior analysis exists, write "First indexed read — no prior analysis to compare against." and move on.

### Segment / product detail
Walk through the segments or product lines that drove the print. If a segment surprised either way, say why.

### Balance sheet + capital allocation
Share count direction, debt direction, cash position, buybacks/dividends. Flag debt retirement or new debt.

### MD&A signal
Pull 1–2 specific MD&A passages that change the read on the next quarter or two. Quote them briefly. If management is hedging or repeating prior-quarter language verbatim, say so.

### Thesis implications
If the user's thesis is provided in context, address THEIR specific thesis and invalidation criteria — keep / re-examine / break — citing the filing line that supports each call. Otherwise, give the bull/bear case implications generically.

### What to watch next
2–3 specific items for the next quarter — a segment to track, a metric to clear, a guidance commitment to verify. These will be graded by the NEXT periodic read, so be measurable.

Rules:
- Never invent a number. If a number isn't in the filing text in front of you, say "not disclosed in this filing".
- Never refer to your own training data for fundamentals — only the text in front of you.
- No buy/sell recommendation. No price targets. You're producing research that a PM will integrate into a call.`;

/**
 * Persona for material-event filings — 8-K, Material Change Reports, single-
 * issue press-release-style filings. These don't have segments, MD&A, or
 * balance sheets — forcing them into a periodic template produces filler.
 */
const EVENT_PERSONA = `${HOUSE_STYLE}

You are a sell-side equity analyst writing a single-event read on a material-disclosure filing (8-K, 6-K material, or Material Change Report).

Output 200–400 words of dense markdown. Single events get short reads.

Required structure:

### Event
One sentence: what happened, when.

### Material content
What the filing actually disclosed — verbatim numbers and quoted phrases only.

### Thesis implications
If the user's thesis is provided in context, name the specific criterion this event affects (or "doesn't touch the user's written criteria" if it doesn't). Otherwise, state which thesis dimensions it would affect generically.

### What this means for the next periodic filing
One sentence: what the next 10-Q / annual is likely to confirm, contradict, or quantify based on this event.

Rules:
- Never invent a number. If something isn't disclosed, say so.
- No buy/sell recommendation. No price targets.`;

type SummarizeArgs = {
  userId: string;
  ticker: string;
  filing: Filing & { body: string };
  priorFiling?: (Filing & { body: string }) | null;
};

/**
 * Generate a structured read for one filing. Picks the right persona based
 * on filing type (event filings get the short EVENT_PERSONA; periodic ones
 * get the long PERIODIC_PERSONA). Pulls the user's thesis and the prior AI
 * summary into context so the new read can grade and compare against them.
 */
export async function summarizeQuarterly(
  args: SummarizeArgs,
): Promise<string | null> {
  const { userId, ticker, filing, priorFiling } = args;
  const provider = getProvider();
  const model = getModel();

  // Pull the user's thesis (if any) so the prompt can address it directly
  // instead of inventing a generic bull/bear case.
  const thesis = await prisma.thesis.findFirst({
    where: { userId, ticker, status: { in: ["ACTIVE", "TRIMMED"] } },
    select: { body: true, invalidationCriteria: true },
  });

  // Pull the most recent prior periodic-deep analysis for this ticker, if
  // any — this is what powers the "Versus last time" section.
  const priorAnalysis = await prisma.aIAnalysis.findFirst({
    where: { userId, ticker, kind: "QUARTERLY_DEEP" },
    orderBy: { generatedAt: "desc" },
    select: { body: true, generatedAt: true },
  });

  const isEventFiling = ["EIGHT_K", "MATERIAL_CHANGE_REPORT"].includes(filing.type);
  const persona = isEventFiling ? EVENT_PERSONA : PERIODIC_PERSONA;

  const userMessage = buildPrompt({
    ticker,
    filing,
    priorFiling: priorFiling ?? null,
    thesis: thesis ?? null,
    priorAnalysis,
  });

  let body = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  for await (const ev of provider.streamChat({
    model,
    system: persona,
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
        priorAnalysisId: priorAnalysis ? priorAnalysis.generatedAt.toISOString() : null,
        hasUserThesis: Boolean(thesis),
      },
      model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    },
    select: { id: true },
  });
  return row.id;
}

function buildPrompt(args: {
  ticker: string;
  filing: Filing & { body: string };
  priorFiling: (Filing & { body: string }) | null;
  thesis: { body: string; invalidationCriteria: string | null } | null;
  priorAnalysis: { body: string; generatedAt: Date } | null;
}): string {
  const { ticker, filing, priorFiling, thesis, priorAnalysis } = args;
  const parts: string[] = [];

  parts.push(
    currentContext({
      freshness: [
        { label: `Filing under review (${humanFormType(filing.type)})`, at: filing.filedAt },
        priorFiling
          ? { label: `Prior filing for comparison (${humanFormType(priorFiling.type)})`, at: priorFiling.filedAt }
          : { label: "Prior filing for comparison", at: null },
      ],
      priorAnalysis: priorAnalysis
        ? {
            label: "Your previous read of this company",
            body: priorAnalysis.body,
            generatedAt: priorAnalysis.generatedAt,
          }
        : null,
    }),
  );

  parts.push("");
  parts.push(`Ticker: ${ticker}`);
  parts.push(`Filing URL: ${filing.url}`);

  if (thesis) {
    parts.push("");
    parts.push("--- USER'S WRITTEN THESIS ---");
    parts.push(thesis.body);
    if (thesis.invalidationCriteria) {
      parts.push("");
      parts.push("Invalidation criteria the user wrote:");
      parts.push(thesis.invalidationCriteria);
    }
    parts.push("--- END USER THESIS ---");
  } else {
    parts.push("");
    parts.push("(No user thesis on file for this ticker — write the Thesis implications section generically.)");
  }

  parts.push("");
  parts.push(`<filing kind="current" type="${filing.type}" filedAt="${filing.filedAt.toISOString().slice(0, 10)}">`);
  parts.push(filing.body);
  parts.push("</filing>");

  if (priorFiling) {
    parts.push("");
    parts.push(`<filing kind="prior" type="${priorFiling.type}" filedAt="${priorFiling.filedAt.toISOString().slice(0, 10)}">`);
    parts.push(priorFiling.body);
    parts.push("</filing>");
  }

  parts.push("");
  parts.push("Produce the read per your persona's required structure. Cite numbers verbatim from the filing text above.");
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
  filedAt: Date | null;
} | null> {
  const row = await prisma.aIAnalysis.findFirst({
    where: { userId, kind: "QUARTERLY_DEEP", ticker },
    orderBy: { generatedAt: "desc" },
    select: { id: true, title: true, body: true, generatedAt: true, metrics: true },
  });
  if (!row) return null;
  const metrics = row.metrics as { filingId?: string; filedAt?: string } | null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    generatedAt: row.generatedAt,
    filingId: metrics?.filingId ?? null,
    filedAt: metrics?.filedAt ? new Date(metrics.filedAt) : null,
  };
}
