import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchFundamentals, fetchNews, fetchQuote } from "./finnhub";
import { fetchCandlesYahoo, fetchIntraday1D, fetchIntraday1W } from "./yahoo";
import type { Candle, Fundamentals, NewsItem, Quote } from "./types";

export type { Candle, Fundamentals, NewsItem, Quote } from "./types";

const TTL = {
  quote: 60 * 1000, // 1 minute
  news: 30 * 60 * 1000, // 30 minutes
  fundamentals: 24 * 60 * 60 * 1000, // 24 hours
  candles: 12 * 60 * 60 * 1000, // 12 hours
};

const num = (d: { toNumber(): number } | null | undefined) => (d == null ? null : d.toNumber());

// ─── Quote ──────────────────────────────────────────────────────────────

export async function getQuote(ticker: string): Promise<Quote | null> {
  const sym = ticker.toUpperCase();
  const cached = await prisma.quote.findUnique({ where: { ticker: sym } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < TTL.quote) {
    return serializeQuote(cached);
  }

  try {
    const fresh = await fetchQuote(sym);
    if (!fresh) return cached ? serializeQuote(cached) : null;

    const stored = await prisma.quote.upsert({
      where: { ticker: sym },
      create: {
        ticker: sym,
        price: fresh.price,
        change: fresh.change,
        changePct: fresh.changePct,
        prevClose: fresh.prevClose,
        open: fresh.open,
        high: fresh.high,
        low: fresh.low,
        asOf: fresh.asOf,
        source: fresh.source,
      },
      update: {
        price: fresh.price,
        change: fresh.change,
        changePct: fresh.changePct,
        prevClose: fresh.prevClose,
        open: fresh.open,
        high: fresh.high,
        low: fresh.low,
        asOf: fresh.asOf,
        source: fresh.source,
        fetchedAt: new Date(),
      },
    });
    return serializeQuote(stored);
  } catch (err) {
    console.error(`[marketdata] quote fetch failed for ${sym}:`, err);
    return cached ? serializeQuote(cached) : null;
  }
}

export async function getQuotes(tickers: string[]): Promise<Map<string, Quote>> {
  const unique = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  const results = await Promise.all(unique.map((t) => getQuote(t)));
  const map = new Map<string, Quote>();
  for (let i = 0; i < unique.length; i++) {
    const q = results[i];
    if (q) map.set(unique[i], q);
  }
  return map;
}

function serializeQuote(row: {
  ticker: string;
  price: { toNumber(): number };
  change: { toNumber(): number };
  changePct: { toNumber(): number };
  prevClose: { toNumber(): number };
  open: { toNumber(): number } | null;
  high: { toNumber(): number } | null;
  low: { toNumber(): number } | null;
  asOf: Date;
  source: string;
}): Quote {
  return {
    ticker: row.ticker,
    price: row.price.toNumber(),
    change: row.change.toNumber(),
    changePct: row.changePct.toNumber(),
    prevClose: row.prevClose.toNumber(),
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    asOf: row.asOf,
    source: row.source,
  };
}

// ─── News ───────────────────────────────────────────────────────────────

export async function getNews(ticker: string, limit = 12): Promise<NewsItem[]> {
  const sym = ticker.toUpperCase();
  const newest = await prisma.newsItem.findFirst({
    where: { ticker: sym },
    orderBy: { fetchedAt: "desc" },
    select: { fetchedAt: true },
  });
  const fresh = newest && Date.now() - newest.fetchedAt.getTime() < TTL.news;

  if (!fresh) {
    try {
      const items = await fetchNews(sym);
      if (items.length > 0) {
        await prisma.newsItem.createMany({
          data: items.map((i) => ({
            id: i.id,
            ticker: sym,
            headline: i.headline,
            summary: i.summary,
            url: i.url,
            source: i.source,
            publishedAt: i.publishedAt,
          })),
          skipDuplicates: true,
        });
      }
    } catch (err) {
      console.error(`[marketdata] news fetch failed for ${sym}:`, err);
    }
  }

  const rows = await prisma.newsItem.findMany({
    where: { ticker: sym },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    headline: r.headline,
    summary: r.summary,
    url: r.url,
    source: r.source,
    publishedAt: r.publishedAt,
  }));
}

// ─── Fundamentals ───────────────────────────────────────────────────────

export async function getFundamentals(ticker: string): Promise<Fundamentals | null> {
  const sym = ticker.toUpperCase();
  const cached = await prisma.fundamentals.findUnique({ where: { ticker: sym } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < TTL.fundamentals) {
    return serializeFundamentals(cached);
  }

  try {
    const fresh = await fetchFundamentals(sym);
    if (!fresh) return cached ? serializeFundamentals(cached) : null;

    const stored = await prisma.fundamentals.upsert({
      where: { ticker: sym },
      create: { ...fresh },
      update: { ...fresh, fetchedAt: new Date() },
    });
    return serializeFundamentals(stored);
  } catch (err) {
    console.error(`[marketdata] fundamentals fetch failed for ${sym}:`, err);
    return cached ? serializeFundamentals(cached) : null;
  }
}

function serializeFundamentals(row: {
  ticker: string;
  companyName: string | null;
  industry: string | null;
  exchange: string | null;
  marketCap: { toNumber(): number } | null;
  peTtm: { toNumber(): number } | null;
  forwardPe: { toNumber(): number } | null;
  dividendYield: { toNumber(): number } | null;
  beta: { toNumber(): number } | null;
  fiftyTwoHigh: { toNumber(): number } | null;
  fiftyTwoLow: { toNumber(): number } | null;
  logo: string | null;
  weburl: string | null;
}): Fundamentals {
  return {
    ticker: row.ticker,
    companyName: row.companyName,
    industry: row.industry,
    exchange: row.exchange,
    marketCap: num(row.marketCap),
    peTtm: num(row.peTtm),
    forwardPe: num(row.forwardPe),
    dividendYield: num(row.dividendYield),
    beta: num(row.beta),
    fiftyTwoHigh: num(row.fiftyTwoHigh),
    fiftyTwoLow: num(row.fiftyTwoLow),
    logo: row.logo,
    weburl: row.weburl,
  };
}

// ─── Candles ────────────────────────────────────────────────────────────

export async function getCandles(ticker: string, days = 90): Promise<Candle[]> {
  const sym = ticker.toUpperCase();
  const cutoff = new Date(Date.now() - days * 86_400_000);

  const newest = await prisma.candle.findFirst({
    where: { ticker: sym },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });

  const cacheHasRecent = newest && Date.now() - newest.ts.getTime() < TTL.candles;

  if (!cacheHasRecent) {
    try {
      const fresh = await fetchCandlesYahoo(sym, days);
      if (fresh.length > 0) {
        await prisma.candle.createMany({
          data: fresh.map((c) => ({
            ticker: sym,
            ts: c.ts,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: BigInt(Math.round(c.volume)),
          })),
          skipDuplicates: true,
        });
      }
    } catch (err) {
      console.error(`[marketdata] candles fetch failed for ${sym}:`, err);
    }
  }

  const rows = await prisma.candle.findMany({
    where: { ticker: sym, ts: { gte: cutoff } },
    orderBy: { ts: "asc" },
  });

  return rows.map((r) => ({
    ts: r.ts,
    open: r.open.toNumber(),
    high: r.high.toNumber(),
    low: r.low.toNumber(),
    close: r.close.toNumber(),
    volume: Number(r.volume),
  }));
}

/**
 * Intraday candles — not cached. The dataset is small and volatile; we just
 * fetch it on each render that needs it.
 */
export async function getIntradayCandles(
  ticker: string,
  range: "1D" | "1W",
): Promise<Candle[]> {
  const sym = ticker.toUpperCase();
  try {
    return range === "1D" ? await fetchIntraday1D(sym) : await fetchIntraday1W(sym);
  } catch (err) {
    console.error(`[marketdata] intraday ${range} fetch failed for ${sym}:`, err);
    return [];
  }
}
