import "server-only";
import { prisma } from "@/lib/prisma";
import { getProvider, getModel } from "@/lib/ai";
import type { EnrichedPortfolio } from "@/lib/portfolio/types";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";

const DAILY_PERSONA = `You are a portfolio manager writing the end-of-day note for a single retail investor.
Keep it tight — 220 words or fewer. Markdown formatting.

Structure:
1. **Lead** — the net portfolio move today in $ and %, and what carried it
2. **Positions** — name the 2-3 biggest contributors (and detractors), with their dollar moves
3. **Risk note** — concentration, unusual day moves, anything to flag
4. **Watch** — one specific thing for tomorrow (an earnings print, a level, a position to re-check)

Style: dense buy-side analyst writing to a peer. **Bold** tickers and key numbers.
No hedging, no "as an AI", no advice. Use the snapshot numbers verbatim — never estimate.`;

const WEEKLY_PERSONA = `You are a portfolio manager writing the weekly review for a single retail investor.
Keep it under 500 words. Markdown formatting with sub-headers.

Structure:
### Week in review
Net portfolio move, biggest contributors and detractors, sector tilts if visible.

### Position-level commentary
For positions that moved materially or whose thesis is being tested, write 1-2 sentences each.

### Risk
Concentration (any single name > 20% weight), drawdowns vs cost, any unusual correlations.

### Worth watching
2-3 specific things for next week — earnings, macro events, key technical levels.

End with: "_This is research, not advice._"

Style: confident, dense, no hedging. **Bold** tickers and key numbers. Use snapshot data only.`;

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
}): Promise<{ body: string; tokens?: { input: number; output: number } } | null> {
  const provider = getProvider();
  const model = getModel();

  const snapshot = formatPortfolioSnapshot(args.portfolio);
  const userMessage = `${args.task}\n\nPortfolio snapshot:\n${snapshot}`;

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

  if (!body.trim()) return null;
  return {
    body: body.trim(),
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
    task: "Write the end-of-day portfolio note.",
    portfolio,
  });
  if (!result) return null;

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
      model: getModel(),
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
    task: "Write the weekly portfolio review.",
    portfolio,
  });
  if (!result) return null;

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
      model: getModel(),
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
