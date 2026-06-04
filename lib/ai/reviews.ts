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

import { buildReviewProposeTool } from "@/lib/ai/review-tools";

const MATERIAL_MOVE_PCT = 3;

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
2-3 specific things for next week — earnings, macro events, key technical levels. These will be graded by next week's review, so be measurable.

### Decisions to raise
You have a \`propose_decision\` tool. Call it ONLY when your review identifies a specific actionable item — a concrete trim, add, harvest, or rebalance leg with rationale and sizing. Do NOT call it for "worth watching" items or general commentary. Each actionable item is one tool call. If nothing in this review needs a tracked decision, don't call it at all — your prose suffices.`;

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
  kind: "WEEKLY";
  system: string;
  task: string;
  portfolio: EnrichedPortfolio;
  priorAnalysisLabel: string;
  tools?: import("@/lib/ai/types").ToolDefinition[];
}): Promise<
  | {
      body: string;
      tokens?: {
        input: number;
        output: number;
        cached?: number;
        cacheCreation?: number;
      };
      skipped?: false;
    }
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
  let usage:
    | { inputTokens: number; outputTokens: number; cachedTokens?: number; cacheCreationTokens?: number }
    | undefined;

  for await (const ev of provider.streamChat({
    model,
    system: args.system,
    messages: [{ role: "user", text: userMessage }],
    tools: args.tools ?? [],
    maxToolRounds: args.tools?.length ? 4 : 1,
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
    tokens: usage
      ? {
          input: usage.inputTokens,
          output: usage.outputTokens,
          cached: usage.cachedTokens,
          cacheCreation: usage.cacheCreationTokens,
        }
      : undefined,
  };
}

export async function generateWeeklyReview(userId: string): Promise<string | null> {
  const portfolio = await getEnrichedPortfolio(userId);
  if (portfolio.holdings.length === 0) return null;

  // Pre-create the AIAnalysis row with a placeholder body so the
  // propose_decision tool can reference its ID. We overwrite the body once
  // the model is done streaming.
  const now = new Date();
  const placeholder = await prisma.aIAnalysis.create({
    data: {
      userId,
      kind: "WEEKLY",
      title: `Weekly review · week of ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      body: "(generating)",
      metrics: {
        totalMarketValue: portfolio.totalMarketValue,
        totalCost: portfolio.totalCost,
        holdingsCount: portfolio.holdings.length,
      },
      model: getModel("review"),
    },
    select: { id: true },
  });

  const proposeTool = buildReviewProposeTool({
    userId,
    source: "WEEKLY_REVIEW",
    reviewId: placeholder.id,
  });

  const result = await generateAnalysis({
    userId,
    kind: "WEEKLY",
    system: WEEKLY_PERSONA,
    task: "Write the weekly portfolio review (or output the skip sentinel if nothing material).",
    portfolio,
    priorAnalysisLabel: "Last week's review",
    tools: [proposeTool],
  });

  // If skipped or empty, delete the placeholder so the inbox isn't littered.
  if (!result || result.skipped) {
    await prisma.aIAnalysis.delete({ where: { id: placeholder.id } }).catch(() => {});
    return null;
  }

  await prisma.aIAnalysis.update({
    where: { id: placeholder.id },
    data: {
      body: result.body,
      inputTokens: result.tokens?.input,
      cachedTokens: result.tokens?.cached,
      cacheCreationTokens: result.tokens?.cacheCreation,
      outputTokens: result.tokens?.output,
    },
  });
  return placeholder.id;
}

export async function getLatestAnalysis(
  userId: string,
  kind: "WEEKLY",
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
