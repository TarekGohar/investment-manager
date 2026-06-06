import "server-only";
import {
  getEarningsTranscript,
  getFinancialStatements,
  getFundamentals,
  getNews,
  getQuote,
  getTickerInsights,
} from "@/lib/marketdata";
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
import { getFilingsForTicker, getInsiderActivity } from "@/lib/filings";
import { tmxGetQuote, tmxGetNews } from "@/lib/marketdata/tmx";
import {
  cisionDeriveSlug,
  cisionListReleases,
  cisionFetchReleaseBody,
} from "@/lib/marketdata/cision";
import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/portfolio/queries";
import { getUserPreferences } from "@/lib/preferences";
import { createDecisionEvent } from "@/lib/alerts/hub";
import { getDecisionHistoryForTicker } from "@/lib/alerts/retrospective";
import { getConvictionTrajectory, recordConvictionRating } from "@/lib/policy/thesis";
import type { ToolDefinition } from "./types";

/**
 * Returns the toolset bound to a given user (and optionally the current
 * conversation). Tools that need user context close over `userId`. The
 * Decision Hub write tool (`propose_decision`) additionally closes over
 * `conversationId` so the event can be linked back to the originating chat.
 * Pure data tools (quote, news, fundamentals) ignore both.
 */
export function buildTools(
  userId: string,
  conversationId?: string,
): ToolDefinition[] {
  return [
    {
      name: "get_quote",
      description:
        "Live (15-min delayed) quote for a US equity ticker. Returns regular-session price, day change, % change, day high/low, previous close, and timestamp. When the market is in pre-market or after-hours, also returns marketState plus the extended-hours price and change (extendedPrice/extendedChangePct) — use these to answer questions about pre-market / after-hours moves.",
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
        const asOfDate = q.asOf instanceof Date ? q.asOf : new Date(q.asOf);
        const session =
          q.marketState === "PRE" || q.marketState === "PREPRE"
            ? "pre-market"
            : q.marketState === "POST" || q.marketState === "POSTPOST"
              ? "after-hours"
              : "regular";
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
          ageMinutes: Math.max(0, Math.floor((Date.now() - asOfDate.getTime()) / 60_000)),
          source: q.source,
          // Extended-hours overlay (US tickers). `price`/`change` above are
          // always the regular session; these reflect the live pre/post move.
          marketState: q.marketState ?? null,
          session,
          extendedPrice: q.extendedPrice ?? null,
          extendedChange: q.extendedChange ?? null,
          extendedChangePct: q.extendedChangePct ?? null,
          extendedAsOf: q.extendedAsOf ?? null,
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
        const now = Date.now();
        return items.map((n) => {
          const pub = n.publishedAt instanceof Date ? n.publishedAt : new Date(n.publishedAt);
          return {
            headline: n.headline,
            summary: n.summary,
            source: n.source,
            publishedAt: n.publishedAt,
            ageDays: Math.floor((now - pub.getTime()) / 86_400_000),
            url: n.url,
          };
        });
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
        "The user's entire portfolio derived from their transaction ledger. Returns each holding with shares, avg cost, cost basis (native + CAD), ACB for the non-reg pool, realized gain, dividends received, foreign tax withheld, per-account-kind breakdown (TFSA/RRSP/non-reg/etc.), market value, day change, unrealized P&L, plus totals across the book.",
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
        "The user's full transaction history for a ticker: every buy, sell, dividend, split, and corporate action with date, quantity, price, fees, and account kind. Returns ALL rows (full ledger is needed for ACB / superficial-loss / corporate-action analysis on long-held positions), most-recent first. Row IDs and null-valued metadata fields are omitted for density only — no analytical info is dropped.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const all = await getTransactionHistory(userId, ticker);
        const sorted = all
          .slice()
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        return {
          ticker,
          count: sorted.length,
          transactions: sorted.map((t) => {
            const row: Record<string, unknown> = {
              occurredAt: t.occurredAt.toISOString(),
              kind: t.kind,
              brokerageKind: t.brokerageKind,
              currency: t.currency,
              quantity: t.quantity,
              price: t.price,
              fees: t.fees,
            };
            if (t.fxRateToCad != null) row.fxRateToCad = t.fxRateToCad;
            if (t.foreignTaxWithheld) row.foreignTaxWithheld = t.foreignTaxWithheld;
            if (t.dividendType) row.dividendType = t.dividendType;
            if (t.reasonCode) row.reasonCode = t.reasonCode;
            if (t.isDrip) row.isDrip = true;
            if (t.splitRatio != null) row.splitRatio = t.splitRatio;
            if (t.maturesAt) row.maturesAt = t.maturesAt.toISOString();
            if (t.corporateActionPayload) row.corporateAction = t.corporateActionPayload;
            if (t.note) row.note = t.note;
            return row;
          }),
        };
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
        "The user's Investment Policy Statement: target allocations, geographic targets, drift threshold, HARD CONCENTRATION CAPS (`maxSingleNameWeightPct`, `maxThemeWeightPct`, `capReasoning`), behavioral thresholds, ticker categorization, and free-form notes. Plus the current actual vs target drift table. Empty objects / nulls mean the user has not configured that piece — never substitute a default. The caps are first-class decision inputs: if either is null, refuse to recommend size changes on that dimension and tell the user to set it in Settings → IPS. Use this to answer questions like 'am I drifting from my targets', 'should I add to X', or 'is this position too large'.",
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
      name: "get_all_filings",
      description:
        "All available filings for a ticker, fanned across data sources: SEC EDGAR for US-listed names, webapi.thecse.com for CSE-listed names (full PDF URLs for MD&A, annual financials, material change reports, news releases), TMX Money for TSX/TSXV-listed names (metadata only — no PDFs because SEDAR+'s bot manager blocks our access; use get_canadian_market_quote for current data). Returns up to 1 year of history. Each filing has `source` (EDGAR / CSE / TMX), `type`, `title`, `filedAt`, and `url` when available.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          sinceDays: { type: "integer", minimum: 1, maximum: 3650 },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        const sinceDays = clampInt(getProp(input, "sinceDays"), 365, 1, 3650);
        if (!ticker) return { error: "Missing ticker." };
        const filings = await getFilingsForTicker(ticker, { sinceDays });
        return {
          ticker,
          filings: filings.map((f) => ({
            source: f.source,
            type: f.type,
            title: f.title,
            categoryLabel: f.categoryLabel,
            filedAt: f.filedAt.toISOString(),
            url: f.url,
            externalId: f.externalId,
          })),
        };
      },
    },

    {
      name: "get_insider_activity",
      description:
        "Recent insider transactions (Form 4) for a US-listed ticker. Returns each transaction with insider name, title (Officer / Director / 10% Owner), date, code (P = open-market purchase, S = sale, M = option exercise, G = gift, A = grant), acquired-or-disposed flag, share count, price per share, and shares-owned-after. Filings come from SEC EDGAR. Returns empty for non-US-listed tickers — Canadian SEDI / canadianinsider.com is not yet wired up.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          sinceDays: { type: "integer", minimum: 1, maximum: 730 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        const sinceDays = clampInt(getProp(input, "sinceDays"), 180, 1, 730);
        const limit = clampInt(getProp(input, "limit"), 20, 1, 50);
        if (!ticker) return { error: "Missing ticker." };
        const txns = await getInsiderActivity(ticker, { sinceDays, limit });
        return {
          ticker,
          count: txns.length,
          transactions: txns.map((t) => ({
            insiderName: t.insiderName,
            insiderTitle: t.insiderTitle,
            date: t.transactionDate.toISOString().slice(0, 10),
            code: t.transactionCode,
            action: t.acquiredOrDisposed === "A" ? "ACQUIRED" : t.acquiredOrDisposed === "D" ? "DISPOSED" : null,
            shares: t.shares,
            pricePerShare: t.pricePerShare,
            sharesOwnedAfter: t.sharesOwnedAfter,
            ownership: t.directOwnership === true ? "direct" : t.directOwnership === false ? "indirect" : null,
            filingUrl: t.filingUrl,
          })),
        };
      },
    },

    {
      name: "get_canadian_market_quote",
      description:
        "TMX Money quote + corporate metadata for a Canadian-listed ticker (TSX / TSXV / NEO / Aequitas). Returns price, price change, day volume, prevClose, P/E, market cap (in CAD), shares outstanding, 10/30-day average volume, 52-week high/low, sector, industry. Use this for SHOP.TO, RY, ENB, CNR, etc. — when Yahoo data is sparse or you want richer Canadian-specific fields. Returns null if the ticker isn't on TMX.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const q = await tmxGetQuote(ticker);
        return q ?? { error: `No TMX data for ${ticker}.` };
      },
    },

    {
      name: "get_press_releases",
      description:
        "Recent press releases for a Canadian-listed ticker, sourced from Cision Newswire (newswire.ca) — the dominant Canadian wire that most TSX / TSXV / CSE issuers use to publish material change reports, quarterly results, dividend announcements, and other disclosures. Each release has a URL, headline, preview, and ISO timestamp. Use this for ground-truth Canadian disclosures when SEDAR+ PDFs aren't accessible. Returns empty for tickers we don't have a Cision slug for; the user can override the slug in their TickerListing.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 25 },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        const limit = clampInt(getProp(input, "limit"), 15, 1, 25);
        if (!ticker) return { error: "Missing ticker." };
        const tl = await prisma.tickerListing.findUnique({
          where: { ticker },
          select: { cisionSlug: true, name: true },
        });
        const slug = tl?.cisionSlug || (tl?.name ? cisionDeriveSlug(tl.name) : null);
        if (!slug) {
          return {
            ticker,
            error:
              "No Cision slug for this ticker yet. Save a TickerListing.name or override .cisionSlug to enable.",
          };
        }
        const releases = await cisionListReleases(slug, { limit });
        return {
          ticker,
          slug,
          count: releases.length,
          releases: releases.map((r) => ({
            url: r.url,
            headline: r.headline,
            publishedAt: r.publishedAt?.toISOString() ?? null,
            preview: r.preview,
          })),
        };
      },
    },

    {
      name: "read_press_release",
      description:
        "Fetch the full text of a specific Cision press release given its URL. Returns title, ISO date, and the cleaned article body (~5–30k chars typically). Use this to ground a thesis re-check or material-event analysis on the actual press release content rather than just the headline.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const url = String(getProp(input, "url") ?? "");
        if (!url || !url.includes("newswire.ca")) {
          return { error: "Pass a full Cision (newswire.ca) press release URL." };
        }
        const result = await cisionFetchReleaseBody(url);
        if (!result) return { error: "Couldn't fetch that press release." };
        return {
          url,
          title: result.title,
          publishedAt: result.publishedAt?.toISOString() ?? null,
          body: result.body,
        };
      },
    },

    {
      name: "get_canadian_market_news",
      description:
        "News headlines for a Canadian-listed ticker from TMX Money. Returns headline, datetime, and source. Use when Finnhub coverage is thin for Canadian names. Body text is not available — for deeper context, follow the source up via the article URL when one exists.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 30 },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        const limit = clampInt(getProp(input, "limit"), 15, 1, 30);
        if (!ticker) return { error: "Missing ticker." };
        const news = await tmxGetNews(ticker, limit);
        return { ticker, items: news };
      },
    },

    {
      name: "get_latest_filing_analysis",
      description:
        "Most recent AI quarterly read (10-Q / 10-K / 40-F / 6-K) for a ticker, plus the indexed filing history. Use this to ground commentary on what actually happened in the most recent print. Returns `analysisAgeDays` and `filingAgeDays` so you can judge staleness — if either exceeds 60, follow up with `get_news` / `get_press_releases` to bridge the gap. Returns null `analysis` when no quarterly read has been generated yet — in that case do not fabricate one; list which filings exist in the index instead.",
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
        const now = Date.now();
        const dayMs = 86_400_000;
        return {
          ticker,
          dataAsOf: new Date().toISOString(),
          analysis: analysis
            ? {
                title: analysis.title,
                body: analysis.body,
                generatedAt: analysis.generatedAt.toISOString(),
                analysisAgeDays: Math.floor((now - analysis.generatedAt.getTime()) / dayMs),
                filingId: analysis.filingId,
                filingFiledAt: analysis.filedAt ? analysis.filedAt.toISOString() : null,
                filingAgeDays: analysis.filedAt
                  ? Math.floor((now - analysis.filedAt.getTime()) / dayMs)
                  : null,
              }
            : null,
          filings: filings.map((f) => ({
            id: f.id,
            type: f.type,
            source: f.source,
            title: f.title,
            url: f.url,
            filedAt: f.filedAt.toISOString(),
            ageDays: Math.floor((now - f.filedAt.getTime()) / dayMs),
          })),
        };
      },
    },

    {
      name: "get_earnings_call_transcript",
      description:
        "Earnings-call transcript for a US ticker, segmented by speaker with per-segment sentiment. Use this to ground commentary on what management actually said — guidance, margins, demand, capital allocation, analyst Q&A. Omit `quarter` for the most recent reported call, or pass one like \"2024Q1\". Returns null/error for Canadian-listed names (not covered) or when no transcript is available yet. Long transcripts are truncated (see `truncated`); call again with an earlier `quarter` for prior calls.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "US stock ticker, e.g. AAPL, NVDA." },
          quarter: {
            type: "string",
            description: 'Fiscal quarter in YYYYQ[1-4] form, e.g. "2024Q1". Optional.',
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const quarterRaw = getProp(input, "quarter");
        const quarter = quarterRaw != null ? String(quarterRaw) : undefined;

        const transcript = await getEarningsTranscript(ticker, quarter);
        if (!transcript) {
          return {
            error: `No earnings call transcript available for ${ticker}${
              quarter ? ` ${quarter}` : ""
            }. Transcripts cover US-listed companies and may be unavailable for very recent or not-yet-reported quarters.`,
          };
        }

        // Cap total returned text so a single call can't blow up the context.
        // Prepared remarks lead the transcript, so truncation drops the tail of
        // the analyst Q&A first — the model can request an earlier quarter or be
        // told the call ran long.
        const CHAR_BUDGET = 36_000;
        let used = 0;
        let truncated = false;
        const segments: Array<{
          speaker: string;
          title: string;
          sentiment: string | null;
          content: string;
        }> = [];
        for (const s of transcript.segments) {
          if (used + s.content.length > CHAR_BUDGET) {
            truncated = true;
            break;
          }
          used += s.content.length;
          segments.push({
            speaker: s.speaker,
            title: s.title,
            sentiment: s.sentiment,
            content: s.content,
          });
        }

        return {
          ticker: transcript.ticker,
          quarter: transcript.quarter,
          source: transcript.source,
          totalSegments: transcript.segments.length,
          returnedSegments: segments.length,
          truncated,
          segments,
        };
      },
    },

    {
      name: "get_analyst_view",
      description:
        "Wall Street view + valuation/quality snapshot for a ticker (US or Canadian), from Yahoo. Returns analyst price targets (mean/high/low) and how they compare to the current price, consensus recommendation + the strong-buy→sell trend, recent upgrades/downgrades, valuation multiples (P/E, forward P/E, PEG, P/B, P/S, EV/EBITDA), margins, ROE, growth, balance-sheet health, beta, and short interest. Margins/growth/short-float are percentages. Use for 'what does the Street think', valuation, and crowding/short-squeeze risk.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const i = await getTickerInsights(ticker);
        if (!i) return { error: `No analyst/valuation data available for ${ticker}.` };
        const upside =
          i.targetMean != null && i.currentPrice
            ? ((i.targetMean - i.currentPrice) / i.currentPrice) * 100
            : null;
        return {
          ticker: i.ticker,
          source: i.source,
          currentPrice: i.currentPrice,
          analyst: {
            targetMean: i.targetMean,
            targetHigh: i.targetHigh,
            targetLow: i.targetLow,
            upsideToMeanPct: upside,
            numberOfAnalysts: i.numberOfAnalysts,
            recommendationKey: i.recommendationKey,
            recommendationMean: i.recommendationMean,
            recommendationTrend: i.recommendationTrend,
            recentActions: i.recentActions.map((a) => ({
              firm: a.firm,
              from: a.fromGrade,
              to: a.toGrade,
              action: a.action,
              date: a.date ? a.date.toISOString().slice(0, 10) : null,
            })),
          },
          valuation: {
            marketCap: i.marketCap,
            enterpriseValue: i.enterpriseValue,
            trailingPe: i.trailingPe,
            forwardPe: i.forwardPe,
            pegRatio: i.pegRatio,
            priceToBook: i.priceToBook,
            priceToSales: i.priceToSales,
            evToEbitda: i.evToEbitda,
            beta: i.beta,
          },
          quality: {
            grossMarginPct: i.grossMargin,
            operatingMarginPct: i.operatingMargin,
            profitMarginPct: i.profitMargin,
            returnOnEquityPct: i.returnOnEquity,
            revenueGrowthPct: i.revenueGrowth,
            earningsGrowthPct: i.earningsGrowth,
            totalCash: i.totalCash,
            totalDebt: i.totalDebt,
            debtToEquity: i.debtToEquity,
            freeCashflow: i.freeCashflow,
            currentRatio: i.currentRatio,
          },
          shortInterest: {
            sharesShort: i.sharesShort,
            shortRatioDays: i.shortRatio,
            shortPercentOfFloatPct: i.shortPercentOfFloat,
          },
        };
      },
    },

    {
      name: "get_earnings_calendar",
      description:
        "Upcoming earnings date and dividend dates for a ticker, plus recent EPS surprise history (actual vs estimate). Use to flag 'earnings in N days' before commenting, to plan around ex-dividend dates, or to judge whether a name tends to beat or miss.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const i = await getTickerInsights(ticker);
        if (!i) return { error: `No calendar data available for ${ticker}.` };
        const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
        const dayMs = 86_400_000;
        const daysUntil = (d: Date | null) =>
          d ? Math.round((d.getTime() - Date.now()) / dayMs) : null;
        return {
          ticker: i.ticker,
          source: i.source,
          nextEarningsDate: iso(i.nextEarningsDate),
          daysUntilEarnings: daysUntil(i.nextEarningsDate),
          earningsDateIsEstimate: i.isEarningsDateEstimate,
          exDividendDate: iso(i.exDividendDate),
          dividendPayDate: iso(i.dividendDate),
          forwardEps: i.forwardEps,
          recentSurprises: i.earningsSurprises.map((s) => ({
            quarter: iso(s.quarter),
            epsActual: s.epsActual,
            epsEstimate: s.epsEstimate,
            surprisePct: s.surprisePct,
          })),
        };
      },
    },

    {
      name: "get_financial_statements",
      description:
        "Multi-year annual financials (up to 4 years) for a ticker from Yahoo: revenue, gross profit, operating & net income, total assets/liabilities/equity, cash, total debt, operating cash flow, capex, and free cash flow. Use to ground commentary on growth, margins, leverage, and cash generation over time rather than a single quarter.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const fs = await getFinancialStatements(ticker);
        if (!fs || fs.annual.length === 0) {
          return { error: `No financial statements available for ${ticker}.` };
        }
        return {
          ticker: fs.ticker,
          source: fs.source,
          currency: "as-reported",
          annual: fs.annual.map((p) => ({
            fiscalYearEnd: p.endDate ? p.endDate.toISOString().slice(0, 10) : null,
            totalRevenue: p.totalRevenue,
            grossProfit: p.grossProfit,
            operatingIncome: p.operatingIncome,
            netIncome: p.netIncome,
            totalAssets: p.totalAssets,
            totalLiabilities: p.totalLiabilities,
            totalEquity: p.totalEquity,
            cash: p.cash,
            totalDebt: p.totalDebt,
            operatingCashflow: p.operatingCashflow,
            capex: p.capex,
            freeCashflow: p.freeCashflow,
          })),
        };
      },
    },

    {
      name: "get_contribution_room_status",
      description:
        "TFSA / RRSP / FHSA / RESP contribution room for a given year. Returns each account's user-supplied room available, derived used (sum of cash DEPOSIT transactions into that account this year — buying shares with already-deposited cash does NOT use further room), remaining, and over-contribution flag. `roomAvailable: null` means the user has not entered their room from CRA's NOA yet — you must NOT guess a CRA limit; instead point them to Settings → Contribution room.",
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

    {
      name: "get_thesis_conviction",
      description:
        "Current conviction rating (1-10) on the user's thesis for a ticker, plus when it was last rated and the trajectory (most recent 6 ratings). Use this BEFORE discussing a held position so you know whether the user's current view is fresh or stale. If the rating is null or older than ~90 days, the user is overdue for a re-rate — prompt them before continuing analysis. If the trajectory shows decay (e.g. 9→7→5) without a corresponding TRIM / EXIT decision, that's the 'holding on past conviction' pattern — flag it.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const ticker = (getProp(args, "ticker") as string).toUpperCase();
        const thesis = await prisma.thesis.findUnique({
          where: { userId_ticker: { userId, ticker } },
          select: { id: true, convictionRating: true, convictionRatedAt: true, convictionNotes: true, status: true },
        });
        if (!thesis) {
          return { ok: false, error: `No thesis exists for ${ticker} — can't read conviction.` };
        }
        const trajectory = await getConvictionTrajectory(thesis.id, 6);
        const ratedAt = thesis.convictionRatedAt;
        const daysSince = ratedAt
          ? Math.floor((Date.now() - ratedAt.getTime()) / 86_400_000)
          : null;
        return {
          ticker,
          status: thesis.status,
          currentRating: thesis.convictionRating,
          ratedAt: ratedAt?.toISOString().slice(0, 10) ?? null,
          daysSinceRated: daysSince,
          isStale: daysSince == null || daysSince > 90,
          currentNotes: thesis.convictionNotes,
          trajectory: trajectory.map((r) => ({
            rating: r.rating,
            ratedAt: r.ratedAt.toISOString().slice(0, 10),
            source: r.source,
            notes: r.notes,
          })),
        };
      },
    },

    {
      name: "record_conviction_rating",
      description:
        "Persist a fresh conviction rating (1-10) on a ticker's thesis. Use this when the user gives you a new rating in conversation. Notes are required for any change of 2+ points from the prior rating. Source is AI_CHAT (set automatically). After writing, mention the trajectory in your reply so the user sees the move in context.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          rating: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "1 = 'I'd exit if I were starting fresh today'; 10 = highest-conviction name in the book.",
          },
          notes: {
            type: ["string", "null"],
            description: "Why this rating? Required for changes of 2+ points from the prior rating.",
          },
        },
        required: ["ticker", "rating"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const ticker = (getProp(args, "ticker") as string).toUpperCase();
        const rating = getProp(args, "rating") as number;
        const notes = (getProp(args, "notes") as string | null | undefined) ?? null;
        const result = await recordConvictionRating({
          userId,
          ticker,
          rating,
          notes,
          source: "AI_CHAT",
        });
        if (!result.ok) return result;
        return {
          ok: true,
          ticker,
          rating,
          trajectory: result.trajectory.map((r) => ({
            rating: r.rating,
            ratedAt: r.ratedAt.toISOString().slice(0, 10),
            source: r.source,
          })),
        };
      },
    },

    {
      name: "get_decision_history",
      description:
        "Past decisions raised on a ticker (or across the whole portfolio) with outcomes. Use this BEFORE proposing a new decision on a ticker — it lets you ground your recommendation in the user's track record on this name. If you've recommended ADD on AVGO three times and the user has ABANDONED all three, the right move on the fourth recommendation isn't to recommend again with the same reasoning. Returns chronological entries with action, source, outcome, your past rationale, and the user's outcome notes when present.",
      parameters: {
        type: "object",
        properties: {
          ticker: {
            type: ["string", "null"],
            description: "Filter to a specific ticker (e.g. 'AVGO'). Null returns all recent decisions.",
          },
          sinceMonths: {
            type: ["number", "null"],
            description: "Lookback window in months. Defaults to 24.",
          },
          limit: {
            type: ["number", "null"],
            description: "Max rows. Defaults to 20.",
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const tickerArg = getProp(args, "ticker") as string | null | undefined;
        const sinceMonths = (getProp(args, "sinceMonths") as number | null | undefined) ?? 24;
        const limit = (getProp(args, "limit") as number | null | undefined) ?? 20;
        const rows = await getDecisionHistoryForTicker({
          userId,
          ticker: tickerArg ?? undefined,
          sinceMonths,
          limit,
        });
        return {
          count: rows.length,
          rows: rows.map((r) => ({
            firedAt: r.firedAt.toISOString().slice(0, 10),
            ticker: r.ticker,
            action: r.action,
            source: r.source,
            outcome: r.outcome,
            rationale: r.rationale,
            outcomeNotes: r.outcomeNotes,
          })),
        };
      },
    },

    {
      name: "propose_decision",
      description:
        "Write a decision into the user's Decision Hub inbox. Use this when your recommendation is concrete enough to merit tracking: a specific action on a specific ticker (or portfolio-level), with a rationale, a sizing frame, an invalidation trigger, and ideally a review event. Do NOT call this for general discussion, exploratory questions, or hold-and-do-nothing answers. The user closes the loop manually in the Hub by recording what they actually did. Calling this tool is how the Hub gets cross-chat memory of your recommendations.",
      parameters: {
        type: "object",
        properties: {
          ticker: {
            type: ["string", "null"],
            description: "Ticker the decision is about, e.g. 'AVGO'. Null for portfolio-level decisions (rebalances, cash deployment, etc.).",
          },
          recommendedAction: {
            type: "string",
            enum: [
              "ADD",
              "TRIM",
              "EXIT",
              "HOLD_THROUGH_DRAWDOWN",
              "DEPLOY_ELSEWHERE",
              "HARVEST_LOSS",
              "REBALANCE",
            ],
            description: "What you're recommending the user do. Must be a concrete action — chat-proposed decisions always carry one. If your conclusion is 'the user should think about this' but there's no specific trade, don't call propose_decision; just say it in your reply.",
          },
          urgency: {
            type: "string",
            enum: ["INFO", "MATERIAL", "URGENT"],
            description: "MATERIAL by default. URGENT only when there's a real time-decay (earnings within 48h, ex-div on Monday, TLH window closing, etc.). INFO for low-priority watch items.",
          },
          message: {
            type: "string",
            description: "One-line summary shown on the inbox card. Plain English, e.g. 'Trim 2 AVGO to bring back inside 12% cap.'",
          },
          rationale: {
            type: "string",
            description: "1-3 sentences in PM voice. WHY this name, now. Should be the thesis-grounded reason — not generic.",
          },
          actionDetails: {
            type: "object",
            description: "Structured spec of the trade: ticker, quantity, priceContext, account when relevant.",
            properties: {
              ticker: { type: "string" },
              quantity: { type: "number" },
              priceContext: { type: "string", description: "e.g. '$408-412' or 'at market'." },
              account: { type: "string", description: "e.g. 'TFSA', 'NON_REGISTERED', 'RRSP'." },
            },
            additionalProperties: true,
          },
          sizingRationale: {
            type: "string",
            description: "1-2 sentences on WHY this size. NAV terms, not share-count terms. Required for ADD / TRIM / EXIT.",
          },
          sizingDetails: {
            type: "object",
            description: "Structured sizing math: nominalUsd, pctOfNav, maxLossToInvalidationUsd, maxLossToInvalidationPctOfNav, postTradePositionPctOfNav, postTradeBucketPctOfTarget. Use the fields that apply.",
            additionalProperties: true,
          },
          supportingEvidence: {
            type: "object",
            description: "Frozen snapshot of the numbers you cited: quote, position size, IPS drift, correlation values, transcript excerpt, etc. Will be displayed as-is on the detail page.",
            additionalProperties: true,
          },
          alternativesConsidered: {
            type: "string",
            description: "1-2 sentences naming what you chose this over. Required for any ADD — capital-allocation discipline.",
          },
          invalidationTrigger: {
            type: "string",
            description: "What would make THIS decision wrong (separate from thesis invalidation). e.g. 'Q4 sequential revenue growth < 5% on Sept 2 print.'",
          },
          reviewEvent: {
            type: "string",
            description: "Human-readable trigger that should bring this decision back up for review, e.g. 'Sept 2 earnings'.",
          },
          reviewByDate: {
            type: "string",
            description: "ISO date (YYYY-MM-DD) by which the decision should be reviewed.",
          },
        },
        required: ["recommendedAction", "message", "rationale"],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (!conversationId) {
          return { ok: false, error: "propose_decision can only be called inside a chat — no conversationId in context." };
        }
        const ticker = (getProp(args, "ticker") as string | null | undefined) ?? null;
        const action = getProp(args, "recommendedAction") as string;
        const urgency = (getProp(args, "urgency") as string | undefined) ?? "MATERIAL";
        const message = getProp(args, "message") as string;
        const rationale = getProp(args, "rationale") as string;
        const sizingRationale = getProp(args, "sizingRationale") as string | undefined;
        const alternativesConsidered = getProp(args, "alternativesConsidered") as string | undefined;
        const invalidationTrigger = getProp(args, "invalidationTrigger") as string | undefined;
        const reviewEvent = getProp(args, "reviewEvent") as string | undefined;
        const reviewByDateStr = getProp(args, "reviewByDate") as string | undefined;
        const reviewByDate = reviewByDateStr ? new Date(reviewByDateStr) : null;
        const actionDetails = getProp(args, "actionDetails") as Record<string, unknown> | null | undefined;
        const sizingDetails = getProp(args, "sizingDetails") as Record<string, unknown> | null | undefined;
        const supportingEvidence = getProp(args, "supportingEvidence") as Record<string, unknown> | null | undefined;

        try {
          const event = await createDecisionEvent({
            userId,
            source: "AI_CHAT",
            conversationId,
            ticker,
            message,
            recommendedAction: action as Parameters<typeof createDecisionEvent>[0]["recommendedAction"],
            urgency: urgency as Parameters<typeof createDecisionEvent>[0]["urgency"],
            rationale,
            actionDetails: actionDetails ?? null,
            sizingRationale: sizingRationale ?? null,
            sizingDetails: sizingDetails ?? null,
            supportingEvidence: supportingEvidence ?? null,
            alternativesConsidered: alternativesConsidered ?? null,
            invalidationTrigger: invalidationTrigger ?? null,
            reviewEvent: reviewEvent ?? null,
            reviewByDate: reviewByDate && !isNaN(reviewByDate.getTime()) ? reviewByDate : null,
          });
          return {
            ok: true,
            decisionId: event.id,
            url: `/decisions/${event.id}`,
            message: "Decision recorded. Tell the user it's in their Decisions inbox.",
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to record decision.";
          return { ok: false, error: msg };
        }
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
