import "server-only";
import type { Fundamentals, NewsItem, Quote } from "./types";

const BASE_URL = "https://finnhub.io/api/v1";

class FinnhubError extends Error {
  constructor(
    public status: number,
    public path: string,
    public detail?: string,
  ) {
    super(`Finnhub ${status} on ${path}${detail ? `: ${detail}` : ""}`);
  }
}

async function fhget<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set");

  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("token", key);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new FinnhubError(res.status, path, detail.slice(0, 200));
  }
  return res.json() as Promise<T>;
}

type QuoteResp = {
  c: number; // current
  d: number; // change
  dp: number; // percent change
  h: number; // high of day
  l: number; // low of day
  o: number; // open
  pc: number; // previous close
  t: number; // unix
};

export async function fetchQuote(symbol: string): Promise<Quote | null> {
  const sym = symbol.toUpperCase();
  const r = await fhget<QuoteResp>("/quote", { symbol: sym });
  // Finnhub returns all zeros for unknown tickers
  if (!r.c && !r.pc) return null;
  return {
    ticker: sym,
    price: r.c,
    change: r.d ?? 0,
    changePct: r.dp ?? 0,
    prevClose: r.pc,
    open: r.o || null,
    high: r.h || null,
    low: r.l || null,
    asOf: r.t ? new Date(r.t * 1000) : new Date(),
    source: "finnhub",
  };
}

type NewsResp = Array<{
  id: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
  datetime: number;
  category: string;
}>;

export async function fetchNews(symbol: string, daysBack = 14): Promise<NewsItem[]> {
  const sym = symbol.toUpperCase();
  const today = new Date();
  const past = new Date(Date.now() - daysBack * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const items = await fhget<NewsResp>("/company-news", {
    symbol: sym,
    from: fmt(past),
    to: fmt(today),
  });

  return items.map((i) => ({
    id: `finnhub-${i.id}`,
    ticker: sym,
    headline: i.headline,
    summary: i.summary || null,
    url: i.url,
    source: i.source || "finnhub",
    publishedAt: new Date(i.datetime * 1000),
  }));
}

type ProfileResp = {
  country: string;
  currency: string;
  exchange: string;
  finnhubIndustry: string;
  ipo: string;
  logo: string;
  marketCapitalization: number; // in millions
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
};

type MetricResp = {
  metric: Partial<{
    peTTM: number;
    peExclExtraTTM: number;
    pe: number;
    "52WeekHigh": number;
    "52WeekLow": number;
    dividendYieldIndicatedAnnual: number;
    currentDividendYieldTTM: number;
    beta: number;
    forwardAnnualDividendYield: number;
    "10DayAverageTradingVolume": number;
  }>;
};

export async function fetchFundamentals(symbol: string): Promise<Fundamentals | null> {
  const sym = symbol.toUpperCase();
  const [profile, metric] = await Promise.all([
    fhget<ProfileResp>("/stock/profile2", { symbol: sym }).catch(() => null),
    fhget<MetricResp>("/stock/metric", { symbol: sym, metric: "all" }).catch(() => null),
  ]);

  if (!profile && !metric) return null;
  const m = metric?.metric ?? {};

  const dividendPct = m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual ?? null;
  return {
    ticker: sym,
    companyName: profile?.name ?? null,
    industry: profile?.finnhubIndustry ?? null,
    exchange: profile?.exchange ?? null,
    marketCap: profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : null,
    peTtm: m.peTTM ?? m.pe ?? null,
    forwardPe: null,
    dividendYield: dividendPct != null ? dividendPct / 100 : null,
    beta: m.beta ?? null,
    fiftyTwoHigh: m["52WeekHigh"] ?? null,
    fiftyTwoLow: m["52WeekLow"] ?? null,
    logo: profile?.logo || null,
    weburl: profile?.weburl || null,
  };
}

// Candles are paywalled on Finnhub's free tier. We source historical bars
// from Yahoo Finance via `lib/marketdata/yahoo.ts`.
