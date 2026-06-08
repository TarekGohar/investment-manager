import "server-only";
import YahooFinance from "yahoo-finance2";
import type {
  AnalystAction,
  Candle,
  EarningsSurprise,
  ExtendedHours,
  FinancialPeriod,
  FinancialStatements,
  MarketState,
  RecommendationTrendPoint,
  TickerInsights,
} from "./types";

const yf = new YahooFinance();

type IntradayInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "90m";
type AnyInterval = "1d" | "1wk" | "1mo" | IntradayInterval;

type Quote = {
  date: Date | string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

async function fetchChart(
  symbol: string,
  period1: Date,
  period2: Date,
  interval: AnyInterval,
): Promise<Candle[]> {
  const result = (await yf.chart(symbol.toUpperCase(), {
    period1,
    period2,
    interval,
  })) as { quotes: Quote[] };

  return result.quotes
    .filter((q) => q.close != null && q.date)
    .map((q) => ({
      ts: new Date(q.date as Date | string),
      open: q.open ?? q.close ?? 0,
      high: q.high ?? q.close ?? 0,
      low: q.low ?? q.close ?? 0,
      close: q.close as number,
      volume: q.volume ?? 0,
    }));
}

/** Daily bars going back `days` days. */
export function fetchCandlesYahoo(symbol: string, days = 180): Promise<Candle[]> {
  const period1 = new Date(Date.now() - days * 86_400_000);
  const period2 = new Date();
  return fetchChart(symbol, period1, period2, "1d");
}

/** 5-minute bars covering the last ~3 days (gets us today's session). */
export function fetchIntraday1D(symbol: string): Promise<Candle[]> {
  const period1 = new Date(Date.now() - 3 * 86_400_000);
  const period2 = new Date();
  return fetchChart(symbol, period1, period2, "5m");
}

/** 30-minute bars covering the last ~7 days. */
export function fetchIntraday1W(symbol: string): Promise<Candle[]> {
  const period1 = new Date(Date.now() - 8 * 86_400_000);
  const period2 = new Date();
  return fetchChart(symbol, period1, period2, "30m");
}

// ─── Extended hours (pre-market / after-hours) ────────────────────────────

type YfQuote = {
  symbol?: string;
  marketState?: string;
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
  preMarketTime?: Date | number;
  postMarketPrice?: number;
  postMarketChange?: number;
  postMarketChangePercent?: number;
  postMarketTime?: Date | number;
};

function toDate(t: Date | number | undefined): Date | null {
  if (t == null) return null;
  if (t instanceof Date) return t;
  // Yahoo timestamps are unix seconds.
  return new Date(t * 1000);
}

/**
 * Fetch live pre-/post-market quotes for US equities via Yahoo's `quote`
 * endpoint (no API key). Finnhub's free tier is regular-session only, so this
 * is the extended-hours overlay. Batches every symbol into one request and
 * never throws — extended hours is a nicety, not core data.
 */
export async function fetchExtendedQuotes(
  symbols: string[],
): Promise<Map<string, ExtendedHours>> {
  const map = new Map<string, ExtendedHours>();
  const uniq = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(Boolean);
  if (uniq.length === 0) return map;

  let rows: YfQuote[];
  try {
    // validateResult:false — Yahoo's payload drifts and we only read a few
    // optional fields, so schema validation would only cause spurious throws.
    const res = await yf.quote(uniq, {}, { validateResult: false });
    rows = (Array.isArray(res) ? res : [res]) as YfQuote[];
  } catch (err) {
    console.error("[marketdata] yahoo extended-hours fetch failed:", err);
    return map;
  }

  for (const q of rows) {
    if (!q?.symbol) continue;
    const state = (q.marketState ?? null) as MarketState | null;
    const isPre = state === "PRE" || state === "PREPRE";
    const isPost = state === "POST" || state === "POSTPOST";

    let extendedPrice: number | null = null;
    let extendedChange: number | null = null;
    let extendedChangePct: number | null = null;
    let extendedAsOf: Date | null = null;

    if (isPre && q.preMarketPrice != null) {
      extendedPrice = q.preMarketPrice;
      extendedChange = q.preMarketChange ?? null;
      extendedChangePct = q.preMarketChangePercent ?? null;
      extendedAsOf = toDate(q.preMarketTime);
    } else if (isPost && q.postMarketPrice != null) {
      extendedPrice = q.postMarketPrice;
      extendedChange = q.postMarketChange ?? null;
      extendedChangePct = q.postMarketChangePercent ?? null;
      extendedAsOf = toDate(q.postMarketTime);
    }

    map.set(q.symbol.toUpperCase(), {
      ticker: q.symbol.toUpperCase(),
      marketState: state,
      extendedPrice,
      extendedChange,
      extendedChangePct,
      extendedAsOf,
    });
  }

  return map;
}

// ─── quoteSummary insights (analyst, valuation, calendar, financials) ──────
//
// Yahoo's quoteSummary returns numbers as { raw, fmt } objects and dates as
// { raw: unixSeconds, fmt }. We fetch with validateResult:false (Yahoo's
// payload drifts and we only read a handful of optional fields) and normalize
// defensively — every getter degrades to null rather than throwing.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

function qsNum(v: Raw): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && typeof v.raw === "number") {
    return Number.isFinite(v.raw) ? v.raw : null;
  }
  return null;
}

/** Like qsNum but scales a Yahoo ratio (0.425) into a percent (42.5). */
function qsPct(v: Raw): number | null {
  const num = qsNum(v);
  return num == null ? null : num * 100;
}

function qsDate(v: Raw): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v * 1000);
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
  }
  if (typeof v === "object") {
    if (typeof v.raw === "number") return new Date(v.raw * 1000);
    if (typeof v.fmt === "string") {
      const t = Date.parse(v.fmt);
      return Number.isNaN(t) ? null : new Date(t);
    }
  }
  return null;
}

function qsStr(v: Raw): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function quoteSummary(symbol: string, modules: string[]): Promise<Raw | null> {
  try {
    const res = await yf.quoteSummary(
      symbol.toUpperCase(),
      { modules: modules as any },
      { validateResult: false },
    );
    return res ?? null;
  } catch (err) {
    console.error(`[marketdata] yahoo quoteSummary failed for ${symbol}:`, err);
    return null;
  }
}

/** Analyst coverage, valuation, short interest and calendar — one Yahoo call. */
export async function fetchTickerInsights(
  symbol: string,
): Promise<TickerInsights | null> {
  const sym = symbol.toUpperCase();
  const r = await quoteSummary(sym, [
    "financialData",
    "recommendationTrend",
    "upgradeDowngradeHistory",
    "defaultKeyStatistics",
    "summaryDetail",
    "calendarEvents",
    "earningsHistory",
  ]);
  if (!r) return null;

  const fd: Raw = r.financialData ?? {};
  const ks: Raw = r.defaultKeyStatistics ?? {};
  const sd: Raw = r.summaryDetail ?? {};
  const cal: Raw = r.calendarEvents ?? {};
  const calEarnings: Raw = cal.earnings ?? {};

  const recommendationTrend: RecommendationTrendPoint[] = Array.isArray(
    r.recommendationTrend?.trend,
  )
    ? r.recommendationTrend.trend.slice(0, 4).map((t: Raw) => ({
        period: qsStr(t.period) ?? "",
        strongBuy: qsNum(t.strongBuy) ?? 0,
        buy: qsNum(t.buy) ?? 0,
        hold: qsNum(t.hold) ?? 0,
        sell: qsNum(t.sell) ?? 0,
        strongSell: qsNum(t.strongSell) ?? 0,
      }))
    : [];

  const recentActions: AnalystAction[] = Array.isArray(
    r.upgradeDowngradeHistory?.history,
  )
    ? r.upgradeDowngradeHistory.history.slice(0, 6).map((h: Raw) => ({
        firm: qsStr(h.firm) ?? "—",
        fromGrade: qsStr(h.fromGrade),
        toGrade: qsStr(h.toGrade),
        action: qsStr(h.action),
        date: qsDate(h.epochGradeDate),
      }))
    : [];

  const earningsSurprises: EarningsSurprise[] = Array.isArray(
    r.earningsHistory?.history,
  )
    ? r.earningsHistory.history
        .slice(-4)
        .reverse()
        .map((h: Raw) => ({
          quarter: qsDate(h.quarter),
          epsActual: qsNum(h.epsActual),
          epsEstimate: qsNum(h.epsEstimate),
          surprisePct: qsPct(h.surprisePercent),
        }))
    : [];

  const edArr: Raw[] = Array.isArray(calEarnings.earningsDate)
    ? calEarnings.earningsDate
    : [];
  const nextEarningsDate = edArr.length > 0 ? qsDate(edArr[0]) : null;

  return {
    ticker: sym,
    source: "yahoo",
    currentPrice: qsNum(fd.currentPrice),
    targetMean: qsNum(fd.targetMeanPrice),
    targetHigh: qsNum(fd.targetHighPrice),
    targetLow: qsNum(fd.targetLowPrice),
    numberOfAnalysts: qsNum(fd.numberOfAnalystOpinions),
    recommendationKey: qsStr(fd.recommendationKey),
    recommendationMean: qsNum(fd.recommendationMean),
    recommendationTrend,
    recentActions,
    marketCap: qsNum(sd.marketCap),
    enterpriseValue: qsNum(ks.enterpriseValue),
    trailingPe: qsNum(sd.trailingPE),
    forwardPe: qsNum(sd.forwardPE) ?? qsNum(ks.forwardPE),
    pegRatio: qsNum(ks.pegRatio),
    priceToBook: qsNum(ks.priceToBook),
    priceToSales: qsNum(sd.priceToSalesTrailing12Months),
    evToEbitda: qsNum(ks.enterpriseToEbitda),
    grossMargin: qsPct(fd.grossMargins),
    operatingMargin: qsPct(fd.operatingMargins),
    profitMargin: qsPct(fd.profitMargins),
    returnOnEquity: qsPct(fd.returnOnEquity),
    revenueGrowth: qsPct(fd.revenueGrowth),
    earningsGrowth: qsPct(fd.earningsGrowth),
    totalCash: qsNum(fd.totalCash),
    totalDebt: qsNum(fd.totalDebt),
    debtToEquity: qsNum(fd.debtToEquity),
    freeCashflow: qsNum(fd.freeCashflow),
    currentRatio: qsNum(fd.currentRatio),
    beta: qsNum(sd.beta) ?? qsNum(ks.beta),
    forwardEps: qsNum(ks.forwardEps),
    trailingEps: qsNum(ks.trailingEps),
    sharesShort: qsNum(ks.sharesShort),
    shortRatio: qsNum(ks.shortRatio),
    shortPercentOfFloat: qsPct(ks.shortPercentOfFloat),
    nextEarningsDate,
    isEarningsDateEstimate: edArr.length > 1,
    exDividendDate: qsDate(cal.exDividendDate) ?? qsDate(sd.exDividendDate),
    dividendDate: qsDate(cal.dividendDate) ?? qsDate(sd.dividendDate),
    earningsSurprises,
  };
}

/** Multi-year annual financial statements (income / balance / cash flow).
 *
 * Sourced from Yahoo's `fundamentalsTimeSeries` endpoint — the legacy
 * `quoteSummary` statement modules went mostly empty in November 2024 and the
 * upstream lib now emits a runtime warning recommending the move. The lib
 * strips the `annual`/`quarterly` prefix from response field names, so e.g.
 * `annualTotalRevenue` arrives as `totalRevenue`.
 */
export async function fetchFinancialStatements(
  symbol: string,
): Promise<FinancialStatements | null> {
  const sym = symbol.toUpperCase();
  // ~5y back gives us 4 annual periods plus a buffer in case the most recent
  // year hasn't closed yet on Yahoo's side.
  const period1 = new Date(Date.now() - 5 * 365 * 86_400_000);
  let rows: FtsAllRow[];
  try {
    rows = (await yf.fundamentalsTimeSeries(sym, {
      period1,
      type: "annual",
      module: "all",
    })) as FtsAllRow[];
  } catch {
    return null;
  }
  if (!rows || rows.length === 0) return null;

  // Yahoo returns one record per fiscal-year-end timestamp, with all
  // statement fields merged when `module: "all"`. Group defensively in case
  // it ever splits.
  type Bucket = { date: Date } & Record<string, unknown>;
  const byYear = new Map<number, Bucket>();
  for (const row of rows) {
    const d = toDate(row.date);
    if (!d) continue;
    const y = d.getUTCFullYear();
    const existing = byYear.get(y) ?? ({ date: d } as Bucket);
    byYear.set(y, { ...existing, ...(row as unknown as Bucket), date: d });
  }

  const years = Array.from(byYear.keys()).sort((a, b) => b - a).slice(0, 4);
  if (years.length === 0) return null;

  const annual: FinancialPeriod[] = years.map((y) => {
    const r = byYear.get(y)!;
    const operatingCashflow = num(r.operatingCashFlow);
    const capex = num(r.capitalExpenditure);
    const freeCashFlow =
      num(r.freeCashFlow) ??
      (operatingCashflow != null ? operatingCashflow + (capex ?? 0) : null);
    return {
      endDate: r.date,
      totalRevenue: num(r.totalRevenue),
      grossProfit: num(r.grossProfit),
      operatingIncome: num(r.operatingIncome),
      netIncome: num(r.netIncome),
      totalAssets: num(r.totalAssets),
      totalLiabilities: num(r.totalLiabilitiesNetMinorityInterest),
      totalEquity: num(r.stockholdersEquity) ?? num(r.commonStockEquity),
      cash:
        num(r.cashAndCashEquivalents) ??
        num(r.cashCashEquivalentsAndShortTermInvestments),
      totalDebt: num(r.totalDebt),
      operatingCashflow,
      capex,
      freeCashflow: freeCashFlow,
    };
  });

  return { ticker: sym, source: "yahoo", annual };
}

type FtsAllRow = {
  // The library's .d.ts says `Date`, but at runtime it stores the unix
  // timestamp (seconds) directly. The shared `toDate` helper handles both.
  date: Date | number;
  [key: string]: unknown;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}
