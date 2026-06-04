export type Quote = {
  ticker: string;
  price: number;
  change: number;
  changePct: number;
  prevClose: number;
  open: number | null;
  high: number | null;
  low: number | null;
  asOf: Date;
  source: string;
  /**
   * Extended-hours overlay (US equities only, sourced from Yahoo). `price`,
   * `change` etc. above always reflect the regular session; these fields carry
   * the live pre-/post-market quote when one is active.
   */
  marketState?: MarketState | null;
  extendedPrice?: number | null;
  extendedChange?: number | null;
  extendedChangePct?: number | null;
  extendedAsOf?: Date | null;
};

/** Trading session as reported by Yahoo. */
export type MarketState =
  | "PRE"
  | "REGULAR"
  | "POST"
  | "POSTPOST"
  | "CLOSED"
  | "PREPRE";

/** Live extended-hours snapshot for a single US ticker. */
export type ExtendedHours = {
  ticker: string;
  marketState: MarketState | null;
  /** Pre-/post-market last price, or null outside extended hours. */
  extendedPrice: number | null;
  extendedChange: number | null;
  extendedChangePct: number | null;
  extendedAsOf: Date | null;
};

export type NewsItem = {
  id: string;
  ticker: string;
  headline: string;
  summary: string | null;
  url: string;
  source: string;
  publishedAt: Date;
};

export type Fundamentals = {
  ticker: string;
  companyName: string | null;
  industry: string | null;
  exchange: string | null;
  marketCap: number | null;
  peTtm: number | null;
  forwardPe: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoHigh: number | null;
  fiftyTwoLow: number | null;
  logo: string | null;
  weburl: string | null;
};

export type Candle = {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** One speaker turn within an earnings call. */
export type TranscriptSegment = {
  speaker: string;
  /** Speaker's role/title, e.g. "CEO & Director". May be empty. */
  title: string;
  content: string;
  /** Provider sentiment score for this segment, as a string (e.g. "0.6"). */
  sentiment: string | null;
};

/** A full earnings-call transcript for one fiscal quarter. */
export type EarningsTranscript = {
  ticker: string;
  /** Fiscal quarter, e.g. "2024Q1". */
  quarter: string;
  title: string | null;
  segments: TranscriptSegment[];
  source: string;
};

// ─── Analyst / valuation insights (Yahoo quoteSummary) ────────────────────

export type RecommendationTrendPoint = {
  /** "0m" (current), "-1m", "-2m", "-3m". */
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

export type AnalystAction = {
  firm: string;
  fromGrade: string | null;
  toGrade: string | null;
  /** "up", "down", "init", "main", "reit". */
  action: string | null;
  date: Date | null;
};

export type EarningsSurprise = {
  quarter: Date | null;
  epsActual: number | null;
  epsEstimate: number | null;
  /** Surprise as a percent (e.g. 4.2 = beat by 4.2%). */
  surprisePct: number | null;
};

/**
 * Analyst coverage, valuation/quality ratios, short interest and calendar for
 * a ticker, normalized from Yahoo's quoteSummary. Margin/growth/short-float
 * fields are in **percent** (e.g. 42.5), ratios like P/E and beta are raw.
 */
export type TickerInsights = {
  ticker: string;
  source: string;
  currentPrice: number | null;
  // Analyst coverage
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  numberOfAnalysts: number | null;
  recommendationKey: string | null;
  recommendationMean: number | null;
  recommendationTrend: RecommendationTrendPoint[];
  recentActions: AnalystAction[];
  // Valuation & quality
  marketCap: number | null;
  enterpriseValue: number | null;
  trailingPe: number | null;
  forwardPe: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
  returnOnEquity: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  debtToEquity: number | null;
  freeCashflow: number | null;
  currentRatio: number | null;
  beta: number | null;
  forwardEps: number | null;
  trailingEps: number | null;
  // Short interest
  sharesShort: number | null;
  shortRatio: number | null;
  shortPercentOfFloat: number | null;
  // Calendar
  nextEarningsDate: Date | null;
  /** True when Yahoo only has an estimated earnings window, not a confirmed date. */
  isEarningsDateEstimate: boolean;
  exDividendDate: Date | null;
  dividendDate: Date | null;
  earningsSurprises: EarningsSurprise[];
};

// ─── Financial statements (Yahoo quoteSummary) ────────────────────────────

export type FinancialPeriod = {
  endDate: Date | null;
  totalRevenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  cash: number | null;
  totalDebt: number | null;
  operatingCashflow: number | null;
  capex: number | null;
  freeCashflow: number | null;
};

export type FinancialStatements = {
  ticker: string;
  source: string;
  /** Annual periods, newest first (up to ~4 years). */
  annual: FinancialPeriod[];
};
