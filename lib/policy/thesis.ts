import "server-only";
import { prisma } from "@/lib/prisma";
import { getModel, getProvider } from "@/lib/ai";
import { getQuote, getNews } from "@/lib/marketdata";
import { getHolding } from "@/lib/portfolio/queries";
import { getLatestQuarterlyAnalysis } from "@/lib/ai/filings";
import type { ThesisStatus } from "@/generated/prisma";

export type ThesisRecord = {
  id: string;
  ticker: string;
  body: string;
  invalidationCriteria: string | null;
  priceTargetCad: number | null;
  horizonMonths: number | null;
  status: ThesisStatus;
  lastAiReview: string | null;
  lastReviewedAt: Date | null;
  /** Most recent filings-driven invalidation check (Session 5). */
  lastInvalidationCheckAt: Date | null;
  lastInvalidationConfidence: number | null;
  lastInvalidationReasoning: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ThesisInput = {
  ticker: string;
  body: string;
  invalidationCriteria?: string | null;
  priceTargetCad?: number | null;
  horizonMonths?: number | null;
  status?: ThesisStatus;
};

const REVIEW_PERSONA = `You are a sell-side analyst stress-testing a single retail investor's investment thesis on one position.

The investor wrote down WHY they bought this name and WHAT would invalidate the thesis. You will see that thesis, plus current quote, recent news, and the most recent AI quarterly read (if any).

Output: 250–400 words of markdown.

Structure:

### Verdict
One sentence: "Thesis intact", "Thesis at risk", or "Thesis invalidated" — followed by one sentence of why.

### What's still working
Bullet points where the thesis is being borne out by current data.

### What's not working
Bullet points where current data contradicts the thesis or weakens it. Cite the specific evidence (news headline, quarterly metric, price move).

### Action implied
1–2 sentences. If the user's own invalidation criteria are tripped, say so plainly. If they aren't, say so plainly. No buy/sell recommendation.

Rules:
- Cite numbers and headlines verbatim from the inputs. Don't invent.
- If the inputs don't actually let you judge a piece of the thesis, say "insufficient data to evaluate X" rather than guessing.
- No hedging, no "as an AI", no "this is just one perspective".`;

export async function listTheses(userId: string): Promise<ThesisRecord[]> {
  const rows = await prisma.thesis.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toRecord);
}

export async function getThesis(
  userId: string,
  ticker: string,
): Promise<ThesisRecord | null> {
  const sym = ticker.toUpperCase();
  const row = await prisma.thesis.findUnique({
    where: { userId_ticker: { userId, ticker: sym } },
  });
  return row ? toRecord(row) : null;
}

export async function upsertThesis(
  userId: string,
  input: ThesisInput,
): Promise<ThesisRecord> {
  const sym = input.ticker.toUpperCase();
  const row = await prisma.thesis.upsert({
    where: { userId_ticker: { userId, ticker: sym } },
    update: {
      body: input.body,
      invalidationCriteria: input.invalidationCriteria ?? null,
      priceTargetCad: input.priceTargetCad ?? null,
      horizonMonths: input.horizonMonths ?? null,
      status: input.status ?? "ACTIVE",
    },
    create: {
      userId,
      ticker: sym,
      body: input.body,
      invalidationCriteria: input.invalidationCriteria ?? null,
      priceTargetCad: input.priceTargetCad ?? null,
      horizonMonths: input.horizonMonths ?? null,
      status: input.status ?? "ACTIVE",
    },
  });
  return toRecord(row);
}

export async function deleteThesis(userId: string, ticker: string): Promise<void> {
  const sym = ticker.toUpperCase();
  await prisma.thesis.delete({
    where: { userId_ticker: { userId, ticker: sym } },
  });
}

/**
 * On-demand AI re-check of a thesis against current quote, news, and the
 * latest quarterly filing analysis (if any). Updates `lastAiReview` +
 * `lastReviewedAt` on the row. Returns the new review body or null on
 * failure.
 */
export async function reviewThesis(
  userId: string,
  ticker: string,
): Promise<string | null> {
  const sym = ticker.toUpperCase();
  const thesis = await getThesis(userId, sym);
  if (!thesis) return null;

  const [quote, news, holding, filingAnalysis] = await Promise.all([
    getQuote(sym),
    getNews(sym, 8),
    getHolding(userId, sym),
    getLatestQuarterlyAnalysis(userId, sym),
  ]);

  const sections: string[] = [];
  sections.push(`Ticker: ${sym}`);
  if (holding) {
    sections.push(
      `Position: ${holding.quantity} sh, ACB ${fmtPrice(holding.acb)}, cost basis ${fmtPrice(holding.costBasis)}`,
    );
  }
  if (quote) {
    sections.push(
      `Current quote: ${fmtPrice(quote.price)} (${quote.changePct.toFixed(2)}% today, prev close ${fmtPrice(quote.prevClose)})`,
    );
  }
  sections.push("");
  sections.push("INVESTOR'S THESIS:");
  sections.push(thesis.body);
  if (thesis.invalidationCriteria) {
    sections.push("");
    sections.push("INVALIDATION CRITERIA:");
    sections.push(thesis.invalidationCriteria);
  }
  if (thesis.priceTargetCad != null) {
    sections.push(`Price target: ${fmtPrice(thesis.priceTargetCad)}`);
  }
  if (thesis.horizonMonths != null) {
    sections.push(`Horizon: ${thesis.horizonMonths} months`);
  }
  if (news.length > 0) {
    sections.push("");
    sections.push("RECENT NEWS:");
    for (const n of news.slice(0, 8)) {
      sections.push(
        `- [${n.publishedAt.toISOString().slice(0, 10)}] ${n.headline}${n.summary ? " — " + n.summary.slice(0, 200) : ""}`,
      );
    }
  }
  if (filingAnalysis) {
    sections.push("");
    sections.push("LATEST AI QUARTERLY READ:");
    sections.push(filingAnalysis.body);
  }
  sections.push("");
  sections.push("Produce the thesis re-check per your structure.");

  const provider = getProvider();
  const model = getModel();
  let body = "";

  for await (const ev of provider.streamChat({
    model,
    system: REVIEW_PERSONA,
    messages: [{ role: "user", text: sections.join("\n") }],
    tools: [],
    maxToolRounds: 1,
  })) {
    if (ev.type === "text") body += ev.delta;
    if (ev.type === "error") return null;
  }

  if (!body.trim()) return null;

  await prisma.thesis.update({
    where: { userId_ticker: { userId, ticker: sym } },
    data: {
      lastAiReview: body.trim(),
      lastReviewedAt: new Date(),
    },
  });

  return body.trim();
}

/**
 * Adaptive price formatting for the AI prompt — keeps fractional cents
 * visible on penny / CSE listings so the model reasons from real numbers.
 */
function fmtPrice(v: number): string {
  const abs = Math.abs(v);
  const digits = abs === 0 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return v.toFixed(digits);
}

function toRecord(row: {
  id: string;
  ticker: string;
  body: string;
  invalidationCriteria: string | null;
  priceTargetCad: { toNumber(): number } | null;
  horizonMonths: number | null;
  status: ThesisStatus;
  lastAiReview: string | null;
  lastReviewedAt: Date | null;
  lastInvalidationCheckAt: Date | null;
  lastInvalidationConfidence: number | null;
  lastInvalidationReasoning: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ThesisRecord {
  return {
    id: row.id,
    ticker: row.ticker,
    body: row.body,
    invalidationCriteria: row.invalidationCriteria,
    priceTargetCad: row.priceTargetCad ? row.priceTargetCad.toNumber() : null,
    horizonMonths: row.horizonMonths,
    status: row.status,
    lastAiReview: row.lastAiReview,
    lastReviewedAt: row.lastReviewedAt,
    lastInvalidationCheckAt: row.lastInvalidationCheckAt,
    lastInvalidationConfidence: row.lastInvalidationConfidence,
    lastInvalidationReasoning: row.lastInvalidationReasoning,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
