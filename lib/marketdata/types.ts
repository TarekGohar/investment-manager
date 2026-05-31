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
