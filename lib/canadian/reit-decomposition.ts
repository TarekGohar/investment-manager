import "server-only";
import { prisma } from "@/lib/prisma";
import type { DividendType, Prisma } from "@/generated/prisma";

/**
 * REIT / income-trust year-end T3 decomposition.
 *
 * A Canadian REIT or income trust distributes cash through the year tagged
 * (for our import purposes) as a generic DIVIDEND. The actual tax
 * treatment of each dollar isn't known until the trust publishes its T3
 * breakdown — typically in March of the following year.
 *
 * Example: trust REI.UN distributed $4,200 in 2025. March 2026 the
 * sponsor reports: 45% capital gain, 30% return of capital, 15% eligible
 * dividend, 10% interest. We then need to reclassify the 2025 DIVIDEND
 * rows so:
 *   - 30% reduces ACB (RoC, not income)
 *   - 45% becomes capital-gains income
 *   - 15% becomes eligible dividends
 *   - 10% becomes interest income
 *
 * Implementation note: we can't represent a single DIVIDEND row as
 * "split across four buckets" without changing the schema substantially.
 * The pragmatic approach: split each affected DIVIDEND row into N
 * fractional rows tagged with the right `dividendType`. Original-row
 * provenance is preserved in `note` so the user can trace it back.
 */
export type RoCAllocationData = {
  id?: string;
  ticker: string;
  year: number;
  eligibleDividendPct: number;
  nonEligibleDividendPct: number;
  interestPct: number;
  returnOfCapitalPct: number;
  capitalGainPct: number;
  otherPct: number;
  notes: string | null;
  appliedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function listRoCAllocations(userId: string): Promise<RoCAllocationData[]> {
  const rows = await prisma.roCAllocation.findMany({
    where: { userId },
    orderBy: [{ year: "desc" }, { ticker: "asc" }],
  });
  return rows.map(toData);
}

export async function upsertRoCAllocation(
  userId: string,
  input: Omit<RoCAllocationData, "id" | "appliedAt" | "createdAt" | "updatedAt">,
): Promise<RoCAllocationData> {
  const ticker = input.ticker.toUpperCase();
  const sum =
    input.eligibleDividendPct +
    input.nonEligibleDividendPct +
    input.interestPct +
    input.returnOfCapitalPct +
    input.capitalGainPct +
    input.otherPct;
  if (sum > 100.5 || sum < 99.5) {
    throw new Error(
      `Allocation percentages should sum to ~100 (got ${sum.toFixed(2)}). Adjust before saving.`,
    );
  }
  const row = await prisma.roCAllocation.upsert({
    where: { userId_ticker_year: { userId, ticker, year: input.year } },
    update: {
      eligibleDividendPct: input.eligibleDividendPct,
      nonEligibleDividendPct: input.nonEligibleDividendPct,
      interestPct: input.interestPct,
      returnOfCapitalPct: input.returnOfCapitalPct,
      capitalGainPct: input.capitalGainPct,
      otherPct: input.otherPct,
      notes: input.notes ?? null,
      // Reset appliedAt — the user changed the breakdown so a fresh
      // reclassification pass is needed.
      appliedAt: null,
    },
    create: {
      userId,
      ticker,
      year: input.year,
      eligibleDividendPct: input.eligibleDividendPct,
      nonEligibleDividendPct: input.nonEligibleDividendPct,
      interestPct: input.interestPct,
      returnOfCapitalPct: input.returnOfCapitalPct,
      capitalGainPct: input.capitalGainPct,
      otherPct: input.otherPct,
      notes: input.notes ?? null,
    },
  });
  return toData(row);
}

export async function deleteRoCAllocation(userId: string, id: string): Promise<void> {
  const row = await prisma.roCAllocation.findUnique({ where: { id } });
  if (!row || row.userId !== userId) throw new Error("Allocation not found.");
  await prisma.roCAllocation.delete({ where: { id } });
}

export type ReclassifyResult = {
  /** Number of original DIVIDEND rows split. */
  originalCount: number;
  /** Number of newly-created reclassified DIVIDEND rows. */
  createdCount: number;
  /** Total dollar amount processed (in row currencies; not FX'd). */
  totalProcessed: number;
};

/**
 * Re-bucket every DIVIDEND row for (userId, ticker, year) into per-type
 * fractional rows matching the T3 breakdown. Idempotent: re-running with
 * the same allocation no-ops (we mark the allocation `appliedAt`).
 *
 * Originals are KEPT but rewritten so quantity*price still equals zero
 * income (price is set to 0; the new rows carry the actual dollars). The
 * note is updated with a back-pointer so the user can see what happened.
 * This preserves the audit trail without violating the unique constraints.
 *
 * Actually simpler approach: DELETE the original rows and INSERT the
 * fractional rows. The note on the new rows carries the original
 * occurredAt/source-of-truth string.
 */
export async function reclassifyDividendsForYear(
  userId: string,
  ticker: string,
  year: number,
): Promise<ReclassifyResult> {
  const symbol = ticker.toUpperCase();
  const allocation = await prisma.roCAllocation.findUnique({
    where: { userId_ticker_year: { userId, ticker: symbol, year } },
  });
  if (!allocation) throw new Error("No allocation entered for this ticker+year.");

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const dividends = await prisma.transaction.findMany({
    where: {
      userId,
      ticker: symbol,
      kind: "DIVIDEND",
      occurredAt: { gte: yearStart, lt: yearEnd },
    },
    orderBy: { occurredAt: "asc" },
  });

  if (dividends.length === 0) {
    await prisma.roCAllocation.update({
      where: { id: allocation.id },
      data: { appliedAt: new Date() },
    });
    return { originalCount: 0, createdCount: 0, totalProcessed: 0 };
  }

  // Sanity: if the rows already look reclassified (have the "T3 split" tag
  // in note), skip. Idempotency without complex tracking.
  const alreadyReclassified = dividends.every((d) => d.note?.includes("[T3 split]"));
  if (alreadyReclassified) {
    return {
      originalCount: dividends.length,
      createdCount: 0,
      totalProcessed: dividends.reduce((s, d) => s + d.price.toNumber(), 0),
    };
  }

  const pctMap: Array<{ type: DividendType; pct: number }> = (
    [
      { type: "ELIGIBLE" as const, pct: allocation.eligibleDividendPct.toNumber() },
      { type: "NON_ELIGIBLE" as const, pct: allocation.nonEligibleDividendPct.toNumber() },
      { type: "INTEREST" as const, pct: allocation.interestPct.toNumber() },
      { type: "RETURN_OF_CAPITAL" as const, pct: allocation.returnOfCapitalPct.toNumber() },
      {
        type: "OTHER" as const,
        pct: allocation.capitalGainPct.toNumber() + allocation.otherPct.toNumber(),
      },
    ] as Array<{ type: DividendType; pct: number }>
  ).filter((b) => b.pct > 0);

  const totalProcessed = dividends.reduce((s, d) => s + d.price.toNumber(), 0);

  await prisma.$transaction(async (tx) => {
    // For each original dividend, create one fractional row per non-zero bucket
    const inserts: Prisma.TransactionCreateManyInput[] = [];
    for (const orig of dividends) {
      const origAmount = orig.price.toNumber();
      const origFwt = orig.foreignTaxWithheld?.toNumber() ?? 0;
      for (const bucket of pctMap) {
        const fraction = bucket.pct / 100;
        const amount = origAmount * fraction;
        const fwtFraction = origFwt * fraction;
        if (amount <= 0) continue;
        inserts.push({
          userId,
          brokerageId: orig.brokerageId,
          ticker: symbol,
          kind: "DIVIDEND",
          currency: orig.currency,
          fxRateToCad: orig.fxRateToCad,
          dividendType: bucket.type,
          // Round to 4 decimals to keep money exact.
          quantity: 1,
          price: round4(amount),
          fees: 0,
          foreignTaxWithheld: round4(fwtFraction),
          occurredAt: orig.occurredAt,
          note: `[T3 split] ${bucket.pct.toFixed(2)}% of ${origAmount.toFixed(2)} ${orig.currency} (orig ${orig.id})${orig.note ? ` · ${orig.note.slice(0, 100)}` : ""}`,
        });
      }
    }

    // Delete originals, insert fractional replacements
    await tx.transaction.deleteMany({
      where: { id: { in: dividends.map((d) => d.id) } },
    });
    if (inserts.length > 0) {
      await tx.transaction.createMany({ data: inserts });
    }
    await tx.roCAllocation.update({
      where: { id: allocation.id },
      data: { appliedAt: new Date() },
    });
  });

  return {
    originalCount: dividends.length,
    createdCount: dividends.length * pctMap.length,
    totalProcessed,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function toData(row: {
  id: string;
  ticker: string;
  year: number;
  eligibleDividendPct: { toNumber(): number };
  nonEligibleDividendPct: { toNumber(): number };
  interestPct: { toNumber(): number };
  returnOfCapitalPct: { toNumber(): number };
  capitalGainPct: { toNumber(): number };
  otherPct: { toNumber(): number };
  notes: string | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RoCAllocationData {
  return {
    id: row.id,
    ticker: row.ticker,
    year: row.year,
    eligibleDividendPct: row.eligibleDividendPct.toNumber(),
    nonEligibleDividendPct: row.nonEligibleDividendPct.toNumber(),
    interestPct: row.interestPct.toNumber(),
    returnOfCapitalPct: row.returnOfCapitalPct.toNumber(),
    capitalGainPct: row.capitalGainPct.toNumber(),
    otherPct: row.otherPct.toNumber(),
    notes: row.notes,
    appliedAt: row.appliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
