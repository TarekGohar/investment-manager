import "server-only";
import { prisma } from "@/lib/prisma";
import type { BrokerageKind, Prisma } from "@/generated/prisma";
import { getCandles, getQuotes } from "@/lib/marketdata";
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
    const price = priceLookup(h.ticker);
    const marketValue = price != null ? price * h.quantity : 0;
    totalCost += h.costBasis;
    totalMarketValue += marketValue;
    totalRealized += h.realizedGain;
    totalDividends += h.totalDividends;

    for (const k of Object.keys(h.byKind) as BrokerageKind[]) {
      const slice = h.byKind[k];
      if (slice.quantity === 0 && slice.costBasis === 0) continue;
      const sliceMv = price != null ? price * slice.quantity : 0;
      byKind[k].quantity += slice.quantity;
      byKind[k].costBasis += slice.costBasis;
      byKind[k].marketValue += sliceMv;
    }

    holdingRows.push({
      ticker: h.ticker,
      quantity: h.quantity,
      costBasis: h.costBasis,
      marketValue,
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

  const row = computeSnapshot(asOf, transactions, priceLookup);
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
  const candlesByTicker = new Map<string, Map<string, number>>();
  for (const t of tickers) {
    const candles = await getCandles(t, daysSpan);
    const map = new Map<string, number>();
    for (const c of candles) map.set(toIsoDate(c.ts), c.close);
    candlesByTicker.set(t, map);
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

    const priceLookup = (t: string) => candlesByTicker.get(t)?.get(iso) ?? null;
    const row = computeSnapshot(asOf, transactions, priceLookup);

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
