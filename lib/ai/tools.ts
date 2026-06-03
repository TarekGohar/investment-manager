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
