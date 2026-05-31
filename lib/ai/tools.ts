import "server-only";
import { getFundamentals, getNews, getQuote } from "@/lib/marketdata";
import {
  getEnrichedPortfolio,
  getHolding,
  getTransactionHistory,
} from "@/lib/portfolio/queries";
import { analyzePortfolioLocation } from "@/lib/canadian/location";
import { findTlhCandidates } from "@/lib/canadian/tlh";
import {
  detectSuperficialLosses,
  getActiveSuperficialLossWindows,
} from "@/lib/canadian/superficial-loss";
import { getContributionRoomStatus } from "@/lib/canadian/contribution-room";
import { getLatestQuarterlyAnalysis } from "@/lib/ai/filings";
import {
  getCorrelationMatrix,
  getPerformanceSummary,
} from "@/lib/portfolio/performance-summary";
import { computeDrift, getInvestmentPolicy } from "@/lib/policy/ips";
import { listTheses } from "@/lib/policy/thesis";
import { getBehavioralPatternsWithPolicy } from "@/lib/behavioral/patterns";
import { getCashBalances, summarizeCash } from "@/lib/portfolio/cash";
import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/portfolio/queries";
import { getUserPreferences } from "@/lib/preferences";
import type { ToolDefinition } from "./types";

/**
 * Returns the toolset bound to a given user. Tools that need user context
 * (portfolio, positions, transactions) close over `userId`. Pure data tools
 * (quote, news, fundamentals) ignore it.
 */
export function buildTools(userId: string): ToolDefinition[] {
  return [
    {
      name: "get_quote",
      description:
        "Live (15-min delayed) quote for a US equity ticker. Returns price, day change, % change, day high/low, previous close, and timestamp.",
      parameters: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "Stock ticker symbol, e.g. AAPL, NVDA, BRK.B",
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const q = await getQuote(ticker);
        if (!q) return { error: `No quote available for ${ticker}.` };
        return {
          ticker: q.ticker,
          price: q.price,
          change: q.change,
          changePct: q.changePct,
          prevClose: q.prevClose,
          open: q.open,
          high: q.high,
          low: q.low,
          asOf: q.asOf,
          source: q.source,
        };
      },
    },

    {
      name: "get_news",
      description:
        "Recent company news for a ticker. Returns headline, summary, source, URL, published timestamp. Use to ground commentary on what's actually happening.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          limit: {
            type: "integer",
            description: "Max stories to return (default 8, max 20).",
            minimum: 1,
            maximum: 20,
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        const limit = clampInt(getProp(input, "limit"), 8, 1, 20);
        if (!ticker) return { error: "Missing ticker." };
        const items = await getNews(ticker, limit);
        return items.map((n) => ({
          headline: n.headline,
          summary: n.summary,
          source: n.source,
          publishedAt: n.publishedAt,
          url: n.url,
        }));
      },
    },

    {
      name: "get_fundamentals",
      description:
        "Company fundamentals: market cap, P/E (TTM), dividend yield, beta, 52-week range, industry, exchange.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const f = await getFundamentals(ticker);
        return f ?? { error: `No fundamentals available for ${ticker}.` };
      },
    },

    {
      name: "get_my_portfolio",
      description:
        "The user's entire portfolio derived from their transaction ledger. Returns each holding with shares, avg cost, cost basis, market value, day change, unrealized P&L, plus totals across the book.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        return await getEnrichedPortfolio(userId);
      },
    },

    {
      name: "get_my_position",
      description:
        "A single position the user holds: shares, avg cost, cost basis, realized gain, dividends received, holding period. Returns an error if the user does not hold this ticker.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const h = await getHolding(userId, ticker);
        if (!h) return { error: `You don't currently hold ${ticker}.` };
        return h;
      },
    },

    {
      name: "get_transaction_history",
      description:
        "The user's transaction history for a ticker: each buy, sell, dividend, and split with date, quantity, price, fees.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        return await getTransactionHistory(userId, ticker);
      },
    },

    {
      name: "get_tax_loss_harvest_candidates",
      description:
        "Non-registered positions trading below their ACB by enough to make tax-loss harvesting worthwhile. Returns each candidate's unrealized loss, ACB, current price, replacement ETFs that avoid the superficial-loss rule, the earliest safe same-ticker buyback date, and whether an active 30-day window is already open. Dollar tax savings are included ONLY when the user has set their marginal capital-gains rate in their tax profile — otherwise `estimatedTaxSaving` and `userCapGainsRate` are null and you must NOT fabricate a dollar figure.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const [portfolio, transactions, preferences] = await Promise.all([
          getEnrichedPortfolio(userId),
          listTransactions(userId),
          getUserPreferences(userId),
        ]);
        const capGainsRate = preferences.taxProfile.marginalCapGainsRate;
        const candidates = findTlhCandidates({
          holdings: portfolio.holdings,
          transactions,
          capGainsRate,
        });
        return {
          userCapGainsRate: capGainsRate,
          minLoss: 100,
          candidates: candidates.map((c) => ({
            ticker: c.ticker,
            unrealizedLoss: c.unrealizedLoss,
            nonRegQuantity: c.nonRegQuantity,
            acb: c.acb,
            currentPrice: c.currentPrice,
            estimatedTaxSaving: c.estimatedTaxSaving,
            hasActiveWindow: c.hasActiveWindow,
            earliestBuybackDate: c.earliestBuybackDate.toISOString(),
            replacements: c.replacements.map((r) => ({
              ticker: r.ticker,
              label: r.label,
              riskNote: r.riskNote ?? null,
            })),
          })),
        };
      },
    },

    {
      name: "get_superficial_loss_violations",
      description:
        "Past superficial-loss violations on the user's transaction history (sales whose losses CRA disallowed because a same-ticker BUY happened within 30 days before or after), plus any currently active 30-day no-buyback windows. Use this to advise on whether a planned BUY of a ticker is safe, or to explain why a previously realized loss didn't reduce taxable gains.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const transactions = await listTransactions(userId);
        const violations = detectSuperficialLosses(transactions);
        const activeWindows = getActiveSuperficialLossWindows(transactions);
        return {
          violations: violations.map((v) => ({
            ticker: v.ticker,
            saleDate: v.saleDate.toISOString(),
            disallowedLossAmount: v.lossAmount,
            absorbedBy: v.absorbedBy.kind,
            conflictingBuys: v.conflictingBuys.map((b) => ({
              buyDate: b.buyDate.toISOString(),
              relationToSale: b.relationToSale,
              daysApart: b.daysApart,
            })),
          })),
          activeWindows: activeWindows.map((w) => ({
            ticker: w.ticker,
            saleDate: w.saleDate.toISOString(),
            lossAmount: w.lossAmount,
            windowEndsAt: w.windowEndsAt.toISOString(),
            daysRemaining: w.daysRemaining,
          })),
        };
      },
    },

    {
      name: "get_cash_balances",
      description:
        "Cash balance per brokerage account, plus lifetime deposits and withdrawals. Balance = deposits + sell proceeds + dividends (net of FWT) − withdrawals − buy cost (with fees). Cross-currency totals are NOT FX-converted — each currency aggregates separately. A negative balance usually means the user entered a buy or withdrawal before the deposit that funded it. Use this when answering 'how much cash do I have', 'how much did I take out of X', or when sizing a hypothetical buy against available cash.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const balances = await getCashBalances(userId);
        const summary = summarizeCash(balances);
        return {
          totalsByCurrency: summary.totalsByCurrency,
          totalDepositsByCurrency: summary.totalDepositsByCurrency,
          totalWithdrawalsByCurrency: summary.totalWithdrawalsByCurrency,
          accounts: summary.byBrokerage.map((b) => ({
            brokerageName: b.brokerageName,
            brokerageKind: b.brokerageKind,
            currency: b.currency,
            balance: b.balance,
            totalDeposits: b.totalDeposits,
            totalWithdrawals: b.totalWithdrawals,
            totalInternalInflow: b.totalInternalInflow,
            totalInternalOutflow: b.totalInternalOutflow,
          })),
        };
      },
    },

    {
      name: "get_investment_policy",
      description:
        "The user's Investment Policy Statement: target allocations, geographic targets, drift threshold, behavioral thresholds, ticker categorization, and free-form notes. Plus the current actual vs target drift table. Empty objects / nulls mean the user has not configured that piece — never substitute a default. Use this to answer questions like 'am I drifting from my targets' or 'what's my IPS say about X'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const [ips, portfolio] = await Promise.all([
          getInvestmentPolicy(userId),
          getEnrichedPortfolio(userId),
        ]);
        const drift = computeDrift(portfolio.holdings, ips);
        return {
          policy: ips,
          drift: {
            totalMarketValue: drift.totalMarketValue,
            rows: drift.rows,
            uncategorized: drift.uncategorized,
          },
        };
      },
    },

    {
      name: "get_active_theses",
      description:
        "All saved per-position theses (active + archived) — body, invalidation criteria, price target, horizon, status, and most recent AI re-check. Use this to ground commentary on whether the user's *own stated thesis* is still intact, not your independent view.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const rows = await listTheses(userId);
        return rows.map((t) => ({
          ticker: t.ticker,
          status: t.status,
          body: t.body,
          invalidationCriteria: t.invalidationCriteria,
          priceTargetCad: t.priceTargetCad,
          horizonMonths: t.horizonMonths,
          lastAiReview: t.lastAiReview,
          lastReviewedAt: t.lastReviewedAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        }));
      },
    },

    {
      name: "get_behavioral_patterns",
      description:
        "Behavioral pattern flags (panic sells, FOMO buys, overtrading months) detected against the user's *own* configured thresholds. `ranChecks` indicates which checks are active. Null threshold = check disabled. Do not fabricate flags or invent thresholds — point the user to /policy to configure them.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const { report, thresholds } = await getBehavioralPatternsWithPolicy(userId);
        return {
          thresholds,
          ranChecks: report.ranChecks,
          flags: report.flags.map((f) => ({
            ...f,
            occurredAt: "occurredAt" in f ? f.occurredAt.toISOString() : undefined,
          })),
        };
      },
    },

    {
      name: "get_performance_metrics",
      description:
        "Portfolio performance and risk metrics computed from daily NAV snapshots. Returns TWR (period + annualized), IRR, beta vs the user's chosen benchmark, Sharpe ratio, max drawdown, and a return-vs-benchmark equity curve. Fields are null when their input is missing: beta + benchmark TWR require a benchmarkTicker; Sharpe requires riskFreeRate. If those are null, do NOT fabricate values — point the user to Settings → Performance profile. Returns null `correlation` when the user has fewer than 2 holdings.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const preferences = await getUserPreferences(userId);
        const summary = await getPerformanceSummary(
          userId,
          preferences.performanceProfile,
        );
        const correlation = await getCorrelationMatrix(userId);
        return {
          snapshotCount: summary.snapshotCount,
          firstSnapshotDate: summary.firstSnapshotDate?.toISOString() ?? null,
          lastSnapshotDate: summary.lastSnapshotDate?.toISOString() ?? null,
          twr: summary.twr,
          twrAnnualized: summary.twrAnnualized,
          twrBenchmark: summary.twrBenchmark,
          twrBenchmarkAnnualized: summary.twrBenchmarkAnnualized,
          twrAlphaAnnualized: summary.twrAlphaAnnualized,
          irr: summary.irr,
          beta: summary.beta,
          sharpe: summary.sharpe,
          maxDrawdown: summary.maxDrawdown
            ? {
                drawdown: summary.maxDrawdown.drawdown,
                peakDate: summary.maxDrawdown.peakDate.toISOString(),
                troughDate: summary.maxDrawdown.troughDate.toISOString(),
              }
            : null,
          benchmarkTicker: summary.benchmarkTicker,
          riskFreeRate: summary.riskFreeRate,
          correlation,
        };
      },
    },

    {
      name: "get_latest_filing_analysis",
      description:
        "Most recent AI quarterly read (10-Q / 10-K) for a held US-listed ticker, plus the indexed filing history. Use this to ground commentary on what actually happened in the most recent print rather than guessing from training data. Returns null `analysis` when no quarterly read has been generated yet — in that case do not fabricate one; instead say which filings exist in the index and offer to summarize once the cron runs (or summarize on-demand if asked).",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const [analysis, filings] = await Promise.all([
          getLatestQuarterlyAnalysis(userId, ticker),
          prisma.filing.findMany({
            where: { ticker },
            orderBy: { filedAt: "desc" },
            take: 10,
            select: {
              id: true,
              type: true,
              source: true,
              url: true,
              title: true,
              filedAt: true,
            },
          }),
        ]);
        return {
          ticker,
          analysis: analysis
            ? {
                title: analysis.title,
                body: analysis.body,
                generatedAt: analysis.generatedAt.toISOString(),
                filingId: analysis.filingId,
              }
            : null,
          filings: filings.map((f) => ({
            id: f.id,
            type: f.type,
            source: f.source,
            title: f.title,
            url: f.url,
            filedAt: f.filedAt.toISOString(),
          })),
        };
      },
    },

    {
      name: "get_contribution_room_status",
      description:
        "TFSA / RRSP / FHSA / RESP contribution room for a given year. Returns each account's user-supplied room available, derived used (sum of BUY transactions in that account this year), remaining, and over-contribution flag. `roomAvailable: null` means the user has not entered their room from CRA's NOA yet — you must NOT guess a CRA limit; instead point them to Settings → Contribution room.",
      parameters: {
        type: "object",
        properties: {
          year: {
            type: "integer",
            description: "Calendar year, e.g. 2026. Defaults to the current UTC year.",
          },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const yearInput = getProp(input, "year");
        const year =
          typeof yearInput === "number" && Number.isInteger(yearInput)
            ? yearInput
            : new Date().getUTCFullYear();
        const statuses = await getContributionRoomStatus(userId, year);
        return {
          year,
          accounts: statuses.map((s) => ({
            kind: s.kind,
            roomAvailable: s.roomAvailable,
            derivedUsed: s.derivedUsed,
            remaining: s.remaining,
            utilizationPct: s.utilization,
            overContributed: s.overContributed,
          })),
        };
      },
    },

    {
      name: "get_asset_location_analysis",
      description:
        "Canadian asset-location analysis across the user's whole portfolio. For each holding, reports which account type it sits in, whether that's optimal/sub-optimal/mis-located given the security's dividend yield and listing country, and the estimated annual tax drag from being in the wrong account. Use this to advise on relocating positions between TFSA / RRSP / FHSA / non-registered.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const portfolio = await getEnrichedPortfolio(userId);
        if (portfolio.holdings.length === 0) {
          return { error: "Portfolio is empty." };
        }
        const result = await analyzePortfolioLocation(portfolio.holdings);
        return {
          totalEstimatedAnnualBleed: result.totalEstimatedBleed,
          mislocatedCount: result.mislocatedCount,
          suboptimalCount: result.suboptimalCount,
          holdings: Array.from(result.byTicker.entries()).map(([ticker, a]) => ({
            ticker,
            worstScore: a.worstScore,
            totalEstimatedBleed: a.totalEstimatedBleed,
            totalExpectedAnnualDividend: a.totalExpectedAnnualDividend,
            totalExpectedAnnualFWT: a.totalExpectedAnnualFWT,
            perKind: a.perKind.map((slice) => ({
              currentKind: slice.currentKind,
              optimalKind: slice.optimalKind,
              score: slice.score,
              reasoning: slice.reasoning,
              estimatedAnnualBleed: slice.estimatedAnnualBleed,
            })),
          })),
        };
      },
    },
  ];
}

function getProp(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
