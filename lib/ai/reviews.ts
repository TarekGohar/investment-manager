import "server-only";
import { prisma } from "@/lib/prisma";
import { getProvider, getModel } from "@/lib/ai";
import {
  HOUSE_STYLE,
  NO_REVIEW_SENTINEL,
  currentContext,
  isNoReviewSentinel,
} from "@/lib/ai/context";
import type { EnrichedPortfolio } from "@/lib/portfolio/types";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";

const MATERIAL_MOVE_PCT = 3;

const DAILY_PERSONA = `${HOUSE_STYLE}

You are a portfolio manager writing the end-of-day note for a single retail investor.

Output gate — read carefully:
- If the only material change since the last review is intra-day price noise (no single position moved ±${MATERIAL_MOVE_PCT}% or more, no new filing, no thesis-invalidation fire, no IPS drift breach, no material news) — output the literal token "${NO_REVIEW_SENTINEL}" and STOP. Don't write anything else.
- Otherwise: produce the EOD note as below.

Keep it tight — 220 words or fewer. Markdown.

Structure:
1. **Lead** — net portfolio move in $ and %, what carried it
2. **Positions** — name the 2-3 biggest contributors / detractors with dollar moves
3. **Risk note** — concentration, unusual day moves, anything to flag
4. **Watch** — one specific thing for tomorrow. If there's genuinely nothing notable to watch, write "Nothing on the calendar — quiet day expected." instead of inventing filler.

If a YESTERDAY'S DAILY REVIEW block appears in context, your "Watch" item must explicitly grade yesterday's "Watch" item (resolved / still open / superseded).`;

const WEEKLY_PERSONA = `${HOUSE_STYLE}

You are a portfolio manager writing the weekly review for a single retail investor.

Output gate:
- If no position moved ±5% on the week, no new filing landed, no thesis-invalidation alert fired, and no IPS drift was breached — output "${NO_REVIEW_SENTINEL}" and STOP.
- Otherwise: produce the review as below.

Keep it under 500 words. Markdown with sub-headers.

Structure:
### Week in review
Net portfolio move, biggest contributors and detractors, sector tilts if visible.

### Versus last week
If a PRIOR WEEKLY REVIEW block appears in context, grade its "Worth watching" items: resolved, still open, or deteriorated. If no prior review, write "First weekly review — no prior to compare against."

### Position-level commentary
For positions that moved ±${MATERIAL_MOVE_PCT}%+ on the week or whose thesis is being tested, 1-2 sentences each.

### Risk
Concentration (any single name > 20% weight), drawdowns vs cost, unusual correlations.

### Worth watching
2-3 specific things for next week — earnings, macro events, key technical levels. These will be graded by next week's review, so be measurable.`;

function formatPortfolioSnapshot(p: EnrichedPortfolio): string {
  const lines: string[] = [];
  lines.push(`Total invested (cost basis): ${formatCurrency(p.totalCost)}`);
  if (p.hasAnyQuote) {
    lines.push(`Total market value: ${formatCurrency(p.totalMarketValue)}`);
    lines.push(
      `Unrealized P&L: ${formatSignedCurrency(p.totalUnrealized)} (${formatPercent(p.totalUnrealizedPct)})`,
    );
    lines.push(
      `Today: ${formatSignedCurrency(p.totalDayChange)} (${formatPercent(p.totalDayChangePct)})`,
    );
  } else {
    lines.push(`Live quotes: unavailable`);
  }
  lines.push(`Realized P&L (to date): ${formatSignedCurrency(p.totalRealized)}`);
  lines.push(`Dividends received: ${formatCurrency(p.totalDividends)}`);
  lines.push("");
  lines.push("Holdings:");
  for (const h of p.holdings) {
    const weight =
      p.hasAnyQuote && p.totalMarketValue > 0
        ? `${(((h.marketValue ?? 0) / p.totalMarketValue) * 100).toFixed(1)}%`
        : "—";
    const live = h.marketPrice != null ? formatCurrency(h.marketPrice) : "no quote";
    const day =
      h.dayChangePct != null
        ? `${formatPercent(h.dayChangePct)} today`
        : "";
    const unrealized =
      h.unrealized != null
        ? `unrealized ${formatSignedCurrency(h.unrealized)} (${formatPercent(h.unrealizedPct ?? 0)})`
        : "no live PnL";
    lines.push(
      `- ${h.ticker}: ${h.quantity} sh @ ACB ${formatCurrency(h.acb)} (cost basis ${formatCurrency(h.costBasis)}), now ${live}, ${day}, ${unrealized}, weight ${weight}`,
    );
  }
  return lines.join("\n");
}

async function generateAnalysis(args: {
  userId: string;
  kind: "EOD_DAILY" | "WEEKLY";
  system: string;
  task: string;
  portfolio: EnrichedPortfolio;
  priorAnalysisLabel: string;
}): Promise<
  | { body: string; tokens?: { input: number; output: number }; skipped?: false }
  | { skipped: true }
  | null
> {
  const provider = getProvider();
  const model = getModel("review");

  // Find the most recent prior analysis of the same kind so this run can
  // grade its predictions instead of starting cold.
  const prior = await prisma.aIAnalysis.findFirst({
    where: { userId: args.userId, kind: args.kind },
    orderBy: { generatedAt: "desc" },
    select: { body: true, generatedAt: true },
  });

  const snapshot = formatPortfolioSnapshot(args.portfolio);
  const context = currentContext({
    freshness: [
      { label: "Portfolio snapshot", at: args.portfolio.quoteAsOf ?? new Date() },
    ],
    priorAnalysis: prior
      ? { label: args.priorAnalysisLabel, body: prior.body, generatedAt: prior.generatedAt }
      : null,
  });
  const userMessage = `${context}\n\n${args.task}\n\nPortfolio snapshot:\n${snapshot}`;

  let body = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  for await (const ev of provider.streamChat({
    model,
    system: args.system,
    messages: [{ role: "user", text: userMessage }],
    tools: [],
    maxToolRounds: 1,
  })) {
    if (ev.type === "text") body += ev.delta;
    if (ev.type === "done" && ev.usage) usage = ev.usage;
    if (ev.type === "error") return null;
  }

  const trimmed = body.trim();
  if (!trimmed) return null;
  if (isNoReviewSentinel(trimmed)) return { skipped: true };
  return {
    body: trimmed,
    tokens: usage ? { input: usage.inputTokens, output: usage.outputTokens } : undefined,
  };
}

export async function generateDailyReview(userId: string): Promise<string | null> {
  const portfolio = await getEnrichedPortfolio(userId);
  if (portfolio.holdings.length === 0) return null;

  const result = await generateAnalysis({
    userId,
    kind: "EOD_DAILY",
    system: DAILY_PERSONA,
    task: "Write the end-of-day portfolio note (or output the skip sentinel if nothing material).",
    portfolio,
    priorAnalysisLabel: "Yesterday's daily review",
  });
  if (!result || result.skipped) return null;

  const now = new Date();
  const created = await prisma.aIAnalysis.create({
    data: {
      userId,
      kind: "EOD_DAILY",
      title: `Daily review · ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      body: result.body,
      metrics: {
        totalMarketValue: portfolio.totalMarketValue,
        totalCost: portfolio.totalCost,
        totalDayChange: portfolio.totalDayChange,
        totalDayChangePct: portfolio.totalDayChangePct,
        totalUnrealized: portfolio.totalUnrealized,
        hasAnyQuote: portfolio.hasAnyQuote,
        holdingsCount: portfolio.holdings.length,
      },
      model: getModel("review"),
      inputTokens: result.tokens?.input,
      outputTokens: result.tokens?.output,
    },
    select: { id: true },
  });
  return created.id;
}

export async function generateWeeklyReview(userId: string): Promise<string | null> {
  const portfolio = await getEnrichedPortfolio(userId);
  if (portfolio.holdings.length === 0) return null;

  const result = await generateAnalysis({
    userId,
    kind: "WEEKLY",
    system: WEEKLY_PERSONA,
    task: "Write the weekly portfolio review (or output the skip sentinel if nothing material).",
    portfolio,
    priorAnalysisLabel: "Last week's review",
  });
  if (!result || result.skipped) return null;

  const now = new Date();
  const created = await prisma.aIAnalysis.create({
    data: {
      userId,
      kind: "WEEKLY",
      title: `Weekly review · week of ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      body: result.body,
      metrics: {
        totalMarketValue: portfolio.totalMarketValue,
        totalCost: portfolio.totalCost,
        holdingsCount: portfolio.holdings.length,
      },
      model: getModel("review"),
      inputTokens: result.tokens?.input,
      outputTokens: result.tokens?.output,
    },
    select: { id: true },
  });
  return created.id;
}

export async function getLatestAnalysis(
  userId: string,
  kind: "EOD_DAILY" | "WEEKLY",
): Promise<{
  id: string;
  title: string | null;
  body: string;
  generatedAt: Date;
} | null> {
  const row = await prisma.aIAnalysis.findFirst({
    where: { userId, kind },
    orderBy: { generatedAt: "desc" },
    select: { id: true, title: true, body: true, generatedAt: true },
  });
  return row;
}
