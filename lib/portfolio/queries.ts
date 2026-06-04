import "server-only";
import { prisma } from "@/lib/prisma";
import type { Transaction, Brokerage } from "@/generated/prisma";
import { getQuotes, quoteCurrencyForTicker } from "@/lib/marketdata";
import { getFxRateToCad } from "@/lib/marketdata/fx";
import { deriveHoldings, summarize } from "./holdings";
import type {
  EnrichedHolding,
  EnrichedPortfolio,
  Holding,
  PortfolioSummary,
  Tx,
} from "./types";

type TransactionWithBrokerage = Transaction & {
  brokerage: { kind: Brokerage["kind"] };
};

function serializeTx(t: TransactionWithBrokerage): Tx {
  return {
    id: t.id,
    brokerageId: t.brokerageId,
    brokerageKind: t.brokerage.kind,
    ticker: t.ticker,
    kind: t.kind,
    currency: t.currency,
    fxRateToCad: t.fxRateToCad ? t.fxRateToCad.toNumber() : null,
    quantity: t.quantity.toNumber(),
    price: t.price.toNumber(),
    fees: t.fees.toNumber(),
    foreignTaxWithheld: t.foreignTaxWithheld ? t.foreignTaxWithheld.toNumber() : 0,
    dividendType: t.dividendType,
    reasonCode: t.reasonCode,
    isDrip: t.isDrip,
    corporateActionPayload: (t.corporateActionPayload as
      | import("@/lib/portfolio/types").CorporateActionPayload
      | null) ?? null,
    maturesAt: t.maturesAt,
    occurredAt: t.occurredAt,
    note: t.note,
    splitRatio: t.splitRatio ? t.splitRatio.toNumber() : null,
  };
}

export async function listTransactions(
  userId: string,
  opts: { ticker?: string } = {},
): Promise<Tx[]> {
  const where: { userId: string; ticker?: string | null } = { userId };
  if (opts.ticker) where.ticker = opts.ticker.toUpperCase();

  const rows = await prisma.transaction.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    include: { brokerage: { select: { kind: true } } },
  });
  return rows.map(serializeTx);
}

export async function getPortfolio(userId: string): Promise<PortfolioSummary> {
  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { occurredAt: "asc" },
    include: { brokerage: { select: { kind: true } } },
  });
  return summarize(deriveHoldings(rows.map(serializeTx)));
}

export async function getHolding(
  userId: string,
  ticker: string,
): Promise<Holding | null> {
  const rows = await prisma.transaction.findMany({
    where: { userId, ticker: ticker.toUpperCase() },
    orderBy: { occurredAt: "asc" },
    include: { brokerage: { select: { kind: true } } },
  });
  const holdings = deriveHoldings(rows.map(serializeTx));
  return holdings[0] ?? null;
}

export async function getTransactionHistory(
  userId: string,
  ticker: string,
): Promise<Tx[]> {
  return listTransactions(userId, { ticker });
}

/**
 * Bring a quote (always in the security's home-exchange currency) into the
 * position's native currency. CAT quote in USD but position recorded in CAD →
 * multiply by USD→CAD. NFLX quote in USD, position recorded in USD → 1.
 *
 * Pass `usdToCadRate` from `getFxRateToCad("USD", today)`; null falls back to
 * 1, which is wrong but matches the rest of the app's degraded behavior when
 * FX is unavailable.
 */
export function quoteToPositionFactor(
  holdingCurrency: string,
  ticker: string,
  usdToCadRate: number | null,
): number {
  const qc = quoteCurrencyForTicker(ticker);
  if (qc === holdingCurrency) return 1;
  if (qc === "USD" && holdingCurrency === "CAD") return usdToCadRate ?? 1;
  if (qc === "CAD" && holdingCurrency === "USD") {
    return usdToCadRate ? 1 / usdToCadRate : 1;
  }
  return 1;
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
      totalForeignTaxWithheld: summary.totalForeignTaxWithheld,
      quoteAsOf: null,
      hasAnyQuote: false,
    };
  }

  const quotes = await getQuotes(summary.holdings.map((h) => h.ticker));

  // Per-position values stay in the position's native currency (USD trades
  // show USD numbers, CAD trades show CAD numbers). Portfolio-level totals
  // are converted to CAD using today's BoC rate — that's what RBC and other
  // Canadian brokerages do on their summary pages. The rate is fetched
  // once if any non-CAD position exists.
  const today = new Date();
  const hasNonCadPosition = summary.holdings.some((h) => h.currency !== "CAD");
  const hasNonUsdForeign = summary.holdings.some(
    (h) => h.currency !== "CAD" && h.currency !== "USD",
  );
  if (hasNonUsdForeign) {
    console.warn(
      "[portfolio] non-USD foreign currencies detected; totals fall back to 1:1 CAD for those — wire FX for them when first needed.",
    );
  }
  const usdToCadRate = hasNonCadPosition
    ? ((await getFxRateToCad("USD", today))?.rate ?? null)
    : null;

  /** Convert a per-position amount (in position's native currency) to CAD. */
  function toCad(amount: number, positionCurrency: string): number {
    if (positionCurrency === "CAD") return amount;
    if (positionCurrency === "USD") return amount * (usdToCadRate ?? 1);
    // Other currencies (EUR/GBP/etc.) — caller emitted warning above.
    return amount;
  }

  let totalMarketValueCad = 0;
  let totalCostCad = 0;
  let totalRealizedCad = 0;
  let totalDividendsCad = 0;
  let totalForeignTaxCad = 0;
  let totalDayChangeCad = 0;
  let prevDayMarketValueCad = 0;
  let hasAnyQuote = false;
  let latestAsOf: Date | null = null;

  const enriched: EnrichedHolding[] = summary.holdings.map((h) => {
    const q = quotes.get(h.ticker);
    if (q) {
      hasAnyQuote = true;
      if (!latestAsOf || q.asOf > latestAsOf) latestAsOf = q.asOf;
    }
    const factor = quoteToPositionFactor(h.currency, h.ticker, usdToCadRate);
    // Native-currency display values (what the per-row UI uses)
    const marketPrice = q ? q.price * factor : null;
    const marketValue = marketPrice != null ? marketPrice * h.quantity : null;
    const unrealized = marketValue != null ? marketValue - h.costBasis : null;
    const unrealizedPct =
      unrealized != null && h.costBasis > 0 ? (unrealized / h.costBasis) * 100 : null;
    const dayChange = q ? q.change * factor * h.quantity : null;
    const dayChangePct = q?.changePct ?? null;

    // Per-holding CAD aggregation. Same FX rate used to project both market
    // value and cost basis, so unrealized in CAD is self-consistent.
    const marketValueCad = marketValue != null ? toCad(marketValue, h.currency) : null;
    const costBasisCad = toCad(h.costBasis, h.currency);
    const unrealizedCad = marketValueCad != null ? marketValueCad - costBasisCad : null;
    if (marketValueCad != null) totalMarketValueCad += marketValueCad;
    totalCostCad += costBasisCad;
    totalRealizedCad += toCad(h.realizedGain, h.currency);
    totalDividendsCad += toCad(h.totalDividends, h.currency);
    totalForeignTaxCad += toCad(h.totalForeignTaxWithheld, h.currency);
    if (q && dayChange != null) {
      totalDayChangeCad += toCad(dayChange, h.currency);
      prevDayMarketValueCad += toCad(q.prevClose * factor * h.quantity, h.currency);
    }

    return {
      ...h,
      marketPrice,
      marketValue,
      unrealized,
      unrealizedPct,
      dayChange,
      dayChangePct,
      costBasisCad,
      marketValueCad,
      unrealizedCad,
      quoteAsOf: q?.asOf ?? null,
    };
  });

  const totalUnrealized = totalMarketValueCad - totalCostCad;
  const totalUnrealizedPct =
    totalCostCad > 0 ? (totalUnrealized / totalCostCad) * 100 : 0;
  const totalDayChangePct =
    prevDayMarketValueCad > 0 ? (totalDayChangeCad / prevDayMarketValueCad) * 100 : 0;

  return {
    holdings: enriched,
    totalCost: totalCostCad,
    totalMarketValue: totalMarketValueCad,
    totalUnrealized,
    totalUnrealizedPct,
    totalDayChange: totalDayChangeCad,
    totalDayChangePct,
    totalRealized: totalRealizedCad,
    totalDividends: totalDividendsCad,
    totalForeignTaxWithheld: totalForeignTaxCad,
    quoteAsOf: latestAsOf,
    hasAnyQuote,
  };
}

export type UserTicker = {
  ticker: string;
  source: "holding" | "watchlist";
};

export async function getUserTickers(userId: string): Promise<UserTicker[]> {
  const [txTickers, watch] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        // Exclude cash flows — $CASH isn't a real ticker.
        kind: { notIn: ["DEPOSIT", "WITHDRAWAL"] },
      },
      select: { ticker: true },
      distinct: ["ticker"],
    }),
    prisma.watchlistItem.findMany({
      where: { userId },
      select: { ticker: true },
    }),
  ]);
  const seen = new Map<string, UserTicker["source"]>();
  for (const t of txTickers) if (t.ticker) seen.set(t.ticker, "holding");
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

export async function listWatchlist(
  userId: string,
): Promise<{ ticker: string; addedAt: Date; note: string | null }[]> {
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
    create: { userId, name: "Main", currency: "CAD", kind: "NON_REGISTERED" },
    select: { id: true },
  });
  return brokerage.id;
}
