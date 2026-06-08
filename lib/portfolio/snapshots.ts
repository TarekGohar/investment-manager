import "server-only";
import { prisma } from "@/lib/prisma";
import type { BrokerageKind, Prisma } from "@/generated/prisma";
import { getCandles, getQuotes, quoteCurrencyForTicker } from "@/lib/marketdata";
import { getFxRateToCad } from "@/lib/marketdata/fx";
import { deriveHoldings } from "./holdings";
import type { Tx } from "./types";

export type SnapshotByKind = Record<
  BrokerageKind,
  { quantity: number; costBasis: number; marketValue: number }
>;

export type SnapshotHolding = {
  ticker: string;
  quantity: number;
  costBasis: number;
  marketValue: number;
};

export type PortfolioSnapshotRow = {
  date: Date;
  totalCost: number;
  totalMarketValue: number;
  totalRealized: number;
  totalDividends: number;
  byKind: SnapshotByKind;
  holdings: SnapshotHolding[];
};

function emptyByKind(): SnapshotByKind {
  const kinds: BrokerageKind[] = [
    "NON_REGISTERED",
    "JOINT_NON_REGISTERED",
    "TFSA",
    "RRSP",
    "FHSA",
    "RESP",
    "LIRA",
    "RRIF",
    "CORPORATE",
  ];
  const out = {} as SnapshotByKind;
  for (const k of kinds) out[k] = { quantity: 0, costBasis: 0, marketValue: 0 };
  return out;
}

/**
 * Compute a portfolio snapshot for a given user *as of* the given UTC date,
 * using the user's transaction history and a `priceLookup` callback to value
 * positions at that date's close.
 */
function computeSnapshot(
  asOf: Date,
  transactions: Tx[],
  priceLookup: (ticker: string) => number | null,
  usdToCadRate: number | null,
): PortfolioSnapshotRow {
  const cutoff = asOf.getTime();
  const txnsAsOf = transactions.filter((t) => t.occurredAt.getTime() <= cutoff);
  const holdings = deriveHoldings(txnsAsOf);

  const byKind = emptyByKind();
  const holdingRows: SnapshotHolding[] = [];
  let totalCost = 0;
  let totalMarketValue = 0;
  let totalRealized = 0;
  let totalDividends = 0;

  for (const h of holdings) {
    // FX legs:
    //   quoteCcy → holdingCcy: converts the raw quote (always in security's
    //     home-exchange currency) into the position's tracking currency.
    //   holdingCcy → CAD: converts position values to CAD for the snapshot
    //     totals so cross-currency portfolios aggregate cleanly.
    const quoteCcy = quoteCurrencyForTicker(h.ticker);
    const quoteToHolding =
      quoteCcy === h.currency
        ? 1
        : quoteCcy === "USD" && h.currency === "CAD"
          ? (usdToCadRate ?? 1)
          : quoteCcy === "CAD" && h.currency === "USD" && usdToCadRate
            ? 1 / usdToCadRate
            : 1;
    const holdingToCad =
      h.currency === "CAD" ? 1 : h.currency === "USD" ? (usdToCadRate ?? 1) : 1;

    const price = priceLookup(h.ticker);
    const marketValueNative = price != null ? price * quoteToHolding * h.quantity : 0;
    const marketValueCad = marketValueNative * holdingToCad;
    const costBasisCad = h.costBasis * holdingToCad;
    const realizedCad = h.realizedGain * holdingToCad;
    const dividendsCad = h.totalDividends * holdingToCad;

    totalCost += costBasisCad;
    totalMarketValue += marketValueCad;
    totalRealized += realizedCad;
    totalDividends += dividendsCad;

    for (const k of Object.keys(h.byKind) as BrokerageKind[]) {
      const slice = h.byKind[k];
      if (slice.quantity === 0 && slice.costBasis === 0) continue;
      const sliceMvNative = price != null ? price * quoteToHolding * slice.quantity : 0;
      const sliceMvCad = sliceMvNative * holdingToCad;
      const sliceCostCad = slice.costBasis * holdingToCad;
      byKind[k].quantity += slice.quantity;
      byKind[k].costBasis += sliceCostCad;
      byKind[k].marketValue += sliceMvCad;
    }

    holdingRows.push({
      ticker: h.ticker,
      quantity: h.quantity,
      costBasis: costBasisCad,
      marketValue: marketValueCad,
    });
  }

  return {
    date: asOf,
    totalCost,
    totalMarketValue,
    totalRealized,
    totalDividends,
    byKind,
    holdings: holdingRows,
  };
}

/**
 * Write today's snapshot to the DB. Idempotent — uses upsert keyed on
 * (userId, date). Today's price = live quote (already in Quote cache).
 */
export async function writeDailySnapshot(userId: string): Promise<{ written: boolean }> {
  const transactions = await listTransactionsForSnapshot(userId);
  if (transactions.length === 0) return { written: false };

  const tickers = uniqueTickers(transactions);
  const quotes = await getQuotes(tickers);
  const priceLookup = (t: string) => quotes.get(t)?.price ?? null;

  const now = new Date();
  const asOf = utcDateOnly(now);

  // One FX fetch covers all USD-denominated positions for today's snapshot.
  const usdToCad = (await getFxRateToCad("USD", now))?.rate ?? null;

  const row = computeSnapshot(asOf, transactions, priceLookup, usdToCad);
  await upsertSnapshot(userId, row);
  return { written: true };
}

/**
 * Backfill snapshots from `from` to `to` using historical daily candles
 * (populated by `getCandles`). Skips dates already present.
 */
export async function backfillSnapshots(
  userId: string,
  opts: { from: Date; to?: Date },
): Promise<{ written: number }> {
  const transactions = await listTransactionsForSnapshot(userId);
  if (transactions.length === 0) return { written: 0 };

  const tickers = uniqueTickers(transactions);
  const to = utcDateOnly(opts.to ?? new Date());
  const fromDay = utcDateOnly(opts.from);

  // Pull enough history to cover the window. getCandles caches in DB.
  const daysSpan = Math.max(
    30,
    Math.ceil((to.getTime() - fromDay.getTime()) / 86_400_000) + 10,
  );
  // Pre-build a sorted (date, close) array per ticker for O(log n) forward-fill
  // lookup. Forward-fill is necessary because a backfilled day might fall on a
  // market holiday for SOME of the user's tickers (e.g. US Independence Day —
  // US tickers have no candle, Canadian listings still trade). Without
  // forward-fill, computeSnapshot treats the missing US closes as $0 and the
  // whole snapshot day appears to crash to ~CAD-only value — which breaks TWR,
  // beta, and max-drawdown calculations downstream.
  type TickerCandles = { dates: string[]; closes: number[] };
  const candlesByTicker = new Map<string, TickerCandles>();
  for (const t of tickers) {
    const candles = await getCandles(t, daysSpan);
    const sorted = [...candles].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    candlesByTicker.set(t, {
      dates: sorted.map((c) => toIsoDate(c.ts)),
      closes: sorted.map((c) => c.close),
    });
  }

  function priceAsOf(ticker: string, iso: string): number | null {
    const tc = candlesByTicker.get(ticker);
    if (!tc || tc.dates.length === 0) return null;
    // Binary search for the latest dates[i] <= iso. ISO strings sort
    // lexicographically and match calendar order, so string compare is fine.
    let lo = 0;
    let hi = tc.dates.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tc.dates[mid] <= iso) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx === -1 ? null : tc.closes[idx];
  }

  // Existing snapshot dates for this user, to dedupe.
  const existing = await prisma.portfolioSnapshot.findMany({
    where: { userId, date: { gte: fromDay, lte: to } },
    select: { date: true },
  });
  const existingSet = new Set(existing.map((e) => toIsoDate(e.date)));

  let written = 0;
  for (
    let cursor = fromDay.getTime();
    cursor <= to.getTime();
    cursor += 86_400_000
  ) {
    const asOf = new Date(cursor);
    const iso = toIsoDate(asOf);
    if (existingSet.has(iso)) continue;
    // Skip weekends — markets closed, no prices anyway
    const dow = asOf.getUTCDay();
    if (dow === 0 || dow === 6) continue;

    const priceLookup = (t: string) => priceAsOf(t, iso);
    // Historical FX rate for this date — uses BoC cache when present,
    // falls back to today's if the historical date is too old to fetch.
    // For Canadian-only or USD-only portfolios this is a no-op.
    const usdToCad = (await getFxRateToCad("USD", asOf))?.rate ?? null;
    const row = computeSnapshot(asOf, transactions, priceLookup, usdToCad);

    // Skip if portfolio not yet opened on this date
    if (row.holdings.length === 0) continue;

    await upsertSnapshot(userId, row);
    written++;
  }
  return { written };
}

export async function listSnapshots(
  userId: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<PortfolioSnapshotRow[]> {
  const rows = await prisma.portfolioSnapshot.findMany({
    where: {
      userId,
      ...(opts.since ? { date: { gte: opts.since } } : {}),
    },
    orderBy: { date: "asc" },
    take: opts.limit,
  });
  return rows.map((r) => ({
    date: r.date,
    totalCost: r.totalCost.toNumber(),
    totalMarketValue: r.totalMarketValue.toNumber(),
    totalRealized: r.totalRealized.toNumber(),
    totalDividends: r.totalDividends.toNumber(),
    byKind: r.byKind as unknown as SnapshotByKind,
    holdings: r.holdings as unknown as SnapshotHolding[],
  }));
}

async function listTransactionsForSnapshot(userId: string): Promise<Tx[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { occurredAt: "asc" },
    include: { brokerage: { select: { kind: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    brokerageId: t.brokerageId,
    brokerageKind: t.brokerage.kind,
    ticker: t.ticker,
    kind: t.kind,
    currency: t.currency,
    fxRateToCad: t.fxRateToCad ? t.fxRateToCad.toNumber() : null,
    dividendType: t.dividendType,
    reasonCode: t.reasonCode,
    isDrip: t.isDrip,
    corporateActionPayload: (t.corporateActionPayload as
      | import("@/lib/portfolio/types").CorporateActionPayload
      | null) ?? null,
    maturesAt: t.maturesAt,
    quantity: t.quantity.toNumber(),
    price: t.price.toNumber(),
    fees: t.fees.toNumber(),
    foreignTaxWithheld: t.foreignTaxWithheld ? t.foreignTaxWithheld.toNumber() : 0,
    occurredAt: t.occurredAt,
    note: t.note,
    splitRatio: t.splitRatio ? t.splitRatio.toNumber() : null,
  }));
}

async function upsertSnapshot(userId: string, row: PortfolioSnapshotRow) {
  await prisma.portfolioSnapshot.upsert({
    where: { userId_date: { userId, date: row.date } },
    update: {
      totalCost: row.totalCost,
      totalMarketValue: row.totalMarketValue,
      totalRealized: row.totalRealized,
      totalDividends: row.totalDividends,
      byKind: row.byKind as unknown as Prisma.InputJsonValue,
      holdings: row.holdings as unknown as Prisma.InputJsonValue,
    },
    create: {
      userId,
      date: row.date,
      totalCost: row.totalCost,
      totalMarketValue: row.totalMarketValue,
      totalRealized: row.totalRealized,
      totalDividends: row.totalDividends,
      byKind: row.byKind as unknown as Prisma.InputJsonValue,
      holdings: row.holdings as unknown as Prisma.InputJsonValue,
    },
  });
}

function uniqueTickers(txns: Tx[]): string[] {
  const set = new Set<string>();
  for (const t of txns) {
    if (t.ticker) set.add(t.ticker);
  }
  return Array.from(set);
}

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
