import "server-only";
import { prisma } from "@/lib/prisma";
import type { Transaction } from "@/generated/prisma";
import { getQuotes } from "@/lib/marketdata";
import { deriveHoldings, summarize } from "./holdings";
import type { EnrichedHolding, EnrichedPortfolio, Holding, PortfolioSummary, Tx } from "./types";

function serializeTx(t: Transaction): Tx {
  return {
    id: t.id,
    brokerageId: t.brokerageId,
    ticker: t.ticker,
    kind: t.kind,
    quantity: t.quantity.toNumber(),
    price: t.price.toNumber(),
    fees: t.fees.toNumber(),
    occurredAt: t.occurredAt,
    note: t.note,
    splitRatio: t.splitRatio ? t.splitRatio.toNumber() : null,
  };
}

export async function listTransactions(
  userId: string,
  opts: { ticker?: string } = {},
): Promise<Tx[]> {
  const where: { userId: string; ticker?: string } = { userId };
  if (opts.ticker) where.ticker = opts.ticker.toUpperCase();

  const rows = await prisma.transaction.findMany({
    where,
    orderBy: { occurredAt: "desc" },
  });
  return rows.map(serializeTx);
}

export async function getPortfolio(userId: string): Promise<PortfolioSummary> {
  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { occurredAt: "asc" },
  });
  return summarize(deriveHoldings(rows.map(serializeTx)));
}

export async function getHolding(userId: string, ticker: string): Promise<Holding | null> {
  const rows = await prisma.transaction.findMany({
    where: { userId, ticker: ticker.toUpperCase() },
    orderBy: { occurredAt: "asc" },
  });
  const holdings = deriveHoldings(rows.map(serializeTx));
  return holdings[0] ?? null;
}

export async function getTransactionHistory(userId: string, ticker: string): Promise<Tx[]> {
  return listTransactions(userId, { ticker });
}

export async function getEnrichedPortfolio(userId: string): Promise<EnrichedPortfolio> {
  const summary = await getPortfolio(userId);
  if (summary.holdings.length === 0) {
    return {
      holdings: [],
      totalCost: 0,
      totalMarketValue: 0,
      totalUnrealized: 0,
      totalUnrealizedPct: 0,
      totalDayChange: 0,
      totalDayChangePct: 0,
      totalRealized: summary.totalRealized,
      totalDividends: summary.totalDividends,
      quoteAsOf: null,
      hasAnyQuote: false,
    };
  }

  const quotes = await getQuotes(summary.holdings.map((h) => h.ticker));

  let totalMarketValue = 0;
  let totalDayChange = 0;
  let prevDayMarketValue = 0;
  let hasAnyQuote = false;
  let latestAsOf: Date | null = null;

  const enriched: EnrichedHolding[] = summary.holdings.map((h) => {
    const q = quotes.get(h.ticker);
    if (q) {
      hasAnyQuote = true;
      if (!latestAsOf || q.asOf > latestAsOf) latestAsOf = q.asOf;
    }
    const marketPrice = q?.price ?? null;
    const marketValue = marketPrice != null ? marketPrice * h.quantity : null;
    const unrealized = marketValue != null ? marketValue - h.costBasis : null;
    const unrealizedPct =
      unrealized != null && h.costBasis > 0 ? (unrealized / h.costBasis) * 100 : null;
    const dayChange = q ? q.change * h.quantity : null;
    const dayChangePct = q?.changePct ?? null;

    if (marketValue != null) totalMarketValue += marketValue;
    if (q && dayChange != null) {
      totalDayChange += dayChange;
      prevDayMarketValue += q.prevClose * h.quantity;
    }

    return {
      ...h,
      marketPrice,
      marketValue,
      unrealized,
      unrealizedPct,
      dayChange,
      dayChangePct,
      quoteAsOf: q?.asOf ?? null,
    };
  });

  const totalUnrealized = totalMarketValue - summary.totalCost;
  const totalUnrealizedPct =
    summary.totalCost > 0 ? (totalUnrealized / summary.totalCost) * 100 : 0;
  const totalDayChangePct =
    prevDayMarketValue > 0 ? (totalDayChange / prevDayMarketValue) * 100 : 0;

  return {
    holdings: enriched,
    totalCost: summary.totalCost,
    totalMarketValue,
    totalUnrealized,
    totalUnrealizedPct,
    totalDayChange,
    totalDayChangePct,
    totalRealized: summary.totalRealized,
    totalDividends: summary.totalDividends,
    quoteAsOf: latestAsOf,
    hasAnyQuote,
  };
}

export type UserTicker = {
  ticker: string;
  source: "holding" | "watchlist";
};

/**
 * All tickers the user has touched — current/past holdings plus watchlist.
 * Used for in-app search.
 */
export async function getUserTickers(userId: string): Promise<UserTicker[]> {
  const [txTickers, watch] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      select: { ticker: true },
      distinct: ["ticker"],
    }),
    prisma.watchlistItem.findMany({
      where: { userId },
      select: { ticker: true },
    }),
  ]);
  const seen = new Map<string, UserTicker["source"]>();
  for (const t of txTickers) seen.set(t.ticker, "holding");
  for (const w of watch) if (!seen.has(w.ticker)) seen.set(w.ticker, "watchlist");
  return Array.from(seen.entries())
    .map(([ticker, source]) => ({ ticker, source }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export async function isWatched(userId: string, ticker: string): Promise<boolean> {
  const sym = ticker.toUpperCase();
  const row = await prisma.watchlistItem.findUnique({
    where: { userId_ticker: { userId, ticker: sym } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function listWatchlist(userId: string): Promise<{ ticker: string; addedAt: Date; note: string | null }[]> {
  const rows = await prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
  return rows.map((r) => ({ ticker: r.ticker, addedAt: r.addedAt, note: r.note }));
}

export async function ensureDefaultBrokerage(userId: string): Promise<string> {
  const brokerage = await prisma.brokerage.upsert({
    where: { userId_name: { userId, name: "Main" } },
    update: {},
    create: { userId, name: "Main", currency: "USD" },
    select: { id: true },
  });
  return brokerage.id;
}
