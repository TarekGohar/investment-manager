import "server-only";
import { prisma } from "@/lib/prisma";
import { getProvider, getModel } from "@/lib/ai";
import { HOUSE_STYLE, currentContext } from "@/lib/ai/context";
import { getEnrichedPortfolio, listTransactions } from "@/lib/portfolio/queries";
import { getInvestmentPolicy, computeDrift } from "@/lib/policy/ips";
import { listTheses } from "@/lib/policy/thesis";
import { findTlhCandidates } from "@/lib/canadian/tlh";
import {
  formatCurrency,
  formatSignedCurrency,
  formatPercent,
} from "@/lib/format";

const ANNUAL_PERSONA = `${HOUSE_STYLE}

You are a portfolio manager writing the once-a-year deep review for a single retail investor.

Output 800–1200 words of dense markdown. No fluff, no closing pleasantries, no "let me dive in".

Required structure:

### Year in numbers
Lead with the year's NAV move (CAD), total dividends received (gross + after-FWT), realized gains/losses, top contributor + top detractor — verbatim from the snapshot data you'll be given.

### Theses on trial
For each ACTIVE thesis: 2–3 sentences. Is the investor's bull case still credible vs. how the year actually played out? If their invalidation criteria are *near* triggered (even if not over the line), say so plainly. Recommend: keep / trim / re-examine. Do not recommend exit unless the user's own invalidation criteria are explicitly met.

### IPS check-in
Categories drifted past threshold? Categories that the user has no holdings in despite a target weight? Behavioral patterns flagged this year? Cite the snapshot numbers.

### Tax housekeeping
Realized vs. unrealized gain mix. Active TLH opportunities still open at year-end. Year-over-year FWT in registered vs. non-reg. Anything that needs an action before Dec 27 settlement deadline.

### What worked, what didn't
Two short paragraphs. What stance / category / discipline paid off, what didn't. Cite specific positions.

### Versus last year's plan
If a PRIOR ANNUAL REVIEW block appears in context, grade its "Plan for next year" commitments one by one — kept / partially kept / dropped. If no prior annual review, say "First annual review on file."

### Plan for next year
3–5 specific commitments framed as IPS / behavioral changes, not stock picks. Avoid generic "consider rebalancing" — be concrete: "Add a 5% bonds target", "Cap tech weight at 30%", "No new positions in the first quarter without a written thesis". These will be graded by next year's review, so make them measurable.

Rules:
- Never invent a number. If a data section is empty, say "no data" rather than guess.
- No buy/sell recommendations beyond what the user's own IPS / thesis explicitly implies.`;

export async function generateAnnualReview(args: {
  userId: string;
  year: number;
}): Promise<string | null> {
  const { userId, year } = args;
  const portfolio = await getEnrichedPortfolio(userId);
  if (portfolio.holdings.length === 0) return null;

  const transactions = await listTransactions(userId);
  const policy = await getInvestmentPolicy(userId);
  const theses = await listTheses(userId);
  const drift = computeDrift(portfolio.holdings, policy);
  const tlh = findTlhCandidates({
    holdings: portfolio.holdings,
    transactions,
    capGainsRate: null,
  });

  // Year-scoped transaction slices
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const yearTxs = transactions.filter(
    (t) => t.occurredAt >= yearStart && t.occurredAt < yearEnd,
  );

  let dividendsThisYear = 0;
  let fwtThisYear = 0;
  for (const t of yearTxs) {
    if (t.kind === "DIVIDEND") {
      dividendsThisYear += t.price;
      fwtThisYear += t.foreignTaxWithheld;
    }
  }

  // Pull prior annual review so this run can grade last year's commitments.
  const priorReview = await prisma.aIAnalysis.findFirst({
    where: { userId, kind: "ANNUAL_REVIEW" },
    orderBy: { generatedAt: "desc" },
    select: { body: true, generatedAt: true },
  });

  const snapshot = buildSnapshotText({
    year,
    portfolio,
    policy,
    drift,
    theses,
    tlh,
    dividendsThisYear,
    fwtThisYear,
    yearTxCount: yearTxs.length,
  });
  const context = currentContext({
    freshness: [
      { label: "Portfolio snapshot", at: portfolio.quoteAsOf ?? new Date() },
    ],
    priorAnalysis: priorReview
      ? {
          label: "Prior annual review",
          body: priorReview.body,
          generatedAt: priorReview.generatedAt,
        }
      : null,
  });

  const provider = getProvider();
  const model = getModel();
  let body = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  for await (const ev of provider.streamChat({
    model,
    system: ANNUAL_PERSONA,
    messages: [{ role: "user", text: `${context}\n\n${snapshot}` }],
    tools: [],
    maxToolRounds: 1,
  })) {
    if (ev.type === "text") body += ev.delta;
    if (ev.type === "done" && ev.usage) usage = ev.usage;
    if (ev.type === "error") return null;
  }
  if (!body.trim()) return null;

  const row = await prisma.aIAnalysis.create({
    data: {
      userId,
      kind: "ANNUAL_REVIEW",
      title: `${year} annual review`,
      body: body.trim(),
      metrics: {
        year,
        totalMarketValueCad: portfolio.totalMarketValue,
        totalCostCad: portfolio.totalCost,
        totalUnrealizedCad: portfolio.totalUnrealized,
        dividendsThisYear,
        fwtThisYear,
        thesesCount: theses.length,
        driftBreaches: drift.rows.filter((r) => r.exceedsThreshold).length,
        tlhCandidates: tlh.length,
        hasPriorReview: Boolean(priorReview),
      },
      model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    },
    select: { id: true },
  });
  return row.id;
}

function buildSnapshotText(args: {
  year: number;
  portfolio: Awaited<ReturnType<typeof getEnrichedPortfolio>>;
  policy: Awaited<ReturnType<typeof getInvestmentPolicy>>;
  drift: ReturnType<typeof computeDrift>;
  theses: Awaited<ReturnType<typeof listTheses>>;
  tlh: ReturnType<typeof findTlhCandidates>;
  dividendsThisYear: number;
  fwtThisYear: number;
  yearTxCount: number;
}): string {
  const lines: string[] = [];
  const p = args.portfolio;
  lines.push(`Annual review for ${args.year}`);
  lines.push("");
  lines.push("=== Portfolio (CAD) ===");
  lines.push(`Total market value: ${formatCurrency(p.totalMarketValue)}`);
  lines.push(`Total cost basis:   ${formatCurrency(p.totalCost)}`);
  lines.push(
    `Unrealized:         ${formatSignedCurrency(p.totalUnrealized)} (${formatPercent(p.totalUnrealizedPct)})`,
  );
  lines.push(`Realized lifetime:  ${formatSignedCurrency(p.totalRealized)}`);
  lines.push(`Dividends lifetime: ${formatCurrency(p.totalDividends)}`);
  lines.push("");
  lines.push(`=== This year (${args.year}) ===`);
  lines.push(`Transactions: ${args.yearTxCount}`);
  lines.push(`Dividends this year: ${formatCurrency(args.dividendsThisYear)} (FWT ${formatCurrency(args.fwtThisYear)})`);
  lines.push(`Realized this year: not separately tracked — use lifetime realized above and note that this is cumulative across all years, not annual.`);
  lines.push("");
  lines.push("=== Holdings ===");
  for (const h of p.holdings) {
    const weight =
      p.hasAnyQuote && p.totalMarketValue > 0
        ? `${(((h.marketValueCad ?? 0) / p.totalMarketValue) * 100).toFixed(1)}%`
        : "—";
    lines.push(
      `- ${h.ticker} (${h.currency}): ${h.quantity} sh @ ACB ${formatCurrency(h.acb)}; value ${formatCurrency(h.marketValueCad ?? h.costBasisCad)} CAD; unrealized ${formatSignedCurrency(h.unrealizedCad ?? 0)}; weight ${weight}`,
    );
  }
  lines.push("");
  lines.push("=== IPS ===");
  lines.push(
    args.policy.driftThresholdPct != null
      ? `Drift threshold: ${args.policy.driftThresholdPct}%`
      : "No drift threshold set.",
  );
  if (args.drift.rows.length > 0) {
    lines.push("Allocation rows:");
    for (const r of args.drift.rows) {
      lines.push(
        `  ${r.category}: target ${r.targetPct.toFixed(1)}%, actual ${r.actualPct.toFixed(1)}% (drift ${r.driftPct >= 0 ? "+" : ""}${r.driftPct.toFixed(1)}pp)${r.exceedsThreshold ? " ⚠ breach" : ""}`,
      );
    }
  } else {
    lines.push("No IPS targets configured.");
  }
  lines.push("");
  lines.push("=== Active theses ===");
  if (args.theses.length === 0) {
    lines.push("No theses written.");
  } else {
    for (const t of args.theses) {
      if (t.status !== "ACTIVE") continue;
      lines.push(`- ${t.ticker} (${t.status})`);
      lines.push(`  Body: ${t.body.slice(0, 300)}`);
      if (t.invalidationCriteria) {
        lines.push(`  Invalidation: ${t.invalidationCriteria.slice(0, 300)}`);
      }
      if (t.lastInvalidationConfidence != null) {
        lines.push(
          `  Last filings check: ${t.lastInvalidationConfidence}% confidence. ${t.lastInvalidationReasoning?.slice(0, 200) ?? ""}`,
        );
      }
    }
  }
  lines.push("");
  lines.push("=== TLH opportunities currently open ===");
  if (args.tlh.length === 0) {
    lines.push("None.");
  } else {
    for (const c of args.tlh) {
      lines.push(
        `- ${c.ticker}: unrealized loss ${formatSignedCurrency(c.unrealizedLoss)}, replacement ${c.replacements[0]?.ticker ?? "(none on file)"}`,
      );
    }
  }
  lines.push("");
  lines.push(`Produce the annual review per your structure. Year is ${args.year}.`);
  return lines.join("\n");
}

export async function getLatestAnnualReview(
  userId: string,
): Promise<{ id: string; title: string | null; body: string; generatedAt: Date } | null> {
  const row = await prisma.aIAnalysis.findFirst({
    where: { userId, kind: "ANNUAL_REVIEW" },
    orderBy: { generatedAt: "desc" },
    select: { id: true, title: true, body: true, generatedAt: true },
  });
  return row;
}
