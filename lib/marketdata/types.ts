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
