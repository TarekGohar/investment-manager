import "server-only";
import { prisma } from "@/lib/prisma";
import type { EnrichedHolding } from "@/lib/portfolio/types";
import type { Prisma } from "@/generated/prisma";

export type AllocationMap = Record<string, number>;
export type TickerCategoryMap = Record<string, string>;

export type InvestmentPolicyData = {
  targetAllocation: AllocationMap;
  targetGeography: AllocationMap;
  driftThresholdPct: number | null;
  panicSellDrawdownPct: number | null;
  panicSellWindowDays: number | null;
  fomoBuyRunupPct: number | null;
  fomoBuyWindowDays: number | null;
  overtradingPerMonth: number | null;
  tickerCategories: TickerCategoryMap;
  notes: string | null;
};

export const EMPTY_IPS: InvestmentPolicyData = {
  targetAllocation: {},
  targetGeography: {},
  driftThresholdPct: null,
  panicSellDrawdownPct: null,
  panicSellWindowDays: null,
  fomoBuyRunupPct: null,
  fomoBuyWindowDays: null,
  overtradingPerMonth: null,
  tickerCategories: {},
  notes: null,
};

export async function getInvestmentPolicy(
  userId: string,
): Promise<InvestmentPolicyData> {
  const row = await prisma.investmentPolicy.findUnique({ where: { userId } });
  if (!row) return { ...EMPTY_IPS };
  return {
    targetAllocation: (row.targetAllocation as AllocationMap) ?? {},
    targetGeography: (row.targetGeography as AllocationMap) ?? {},
    driftThresholdPct: row.driftThresholdPct ? row.driftThresholdPct.toNumber() : null,
    panicSellDrawdownPct: row.panicSellDrawdownPct
      ? row.panicSellDrawdownPct.toNumber()
      : null,
    panicSellWindowDays: row.panicSellWindowDays,
    fomoBuyRunupPct: row.fomoBuyRunupPct ? row.fomoBuyRunupPct.toNumber() : null,
    fomoBuyWindowDays: row.fomoBuyWindowDays,
    overtradingPerMonth: row.overtradingPerMonth,
    tickerCategories: (row.tickerCategories as TickerCategoryMap) ?? {},
    notes: row.notes,
  };
}

export async function upsertInvestmentPolicy(
  userId: string,
  data: InvestmentPolicyData,
): Promise<void> {
  await prisma.investmentPolicy.upsert({
    where: { userId },
    update: {
      targetAllocation: data.targetAllocation as unknown as Prisma.InputJsonValue,
      targetGeography: data.targetGeography as unknown as Prisma.InputJsonValue,
      driftThresholdPct: data.driftThresholdPct,
      panicSellDrawdownPct: data.panicSellDrawdownPct,
      panicSellWindowDays: data.panicSellWindowDays,
      fomoBuyRunupPct: data.fomoBuyRunupPct,
      fomoBuyWindowDays: data.fomoBuyWindowDays,
      overtradingPerMonth: data.overtradingPerMonth,
      tickerCategories: data.tickerCategories as unknown as Prisma.InputJsonValue,
      notes: data.notes,
    },
    create: {
      userId,
      targetAllocation: data.targetAllocation as unknown as Prisma.InputJsonValue,
      targetGeography: data.targetGeography as unknown as Prisma.InputJsonValue,
      driftThresholdPct: data.driftThresholdPct,
      panicSellDrawdownPct: data.panicSellDrawdownPct,
      panicSellWindowDays: data.panicSellWindowDays,
      fomoBuyRunupPct: data.fomoBuyRunupPct,
      fomoBuyWindowDays: data.fomoBuyWindowDays,
      overtradingPerMonth: data.overtradingPerMonth,
      tickerCategories: data.tickerCategories as unknown as Prisma.InputJsonValue,
      notes: data.notes,
    },
  });
}

export type AllocationRow = {
  category: string;
  targetPct: number;
  actualPct: number;
  driftPct: number;
  /** True when |driftPct| exceeds the user's drift threshold. */
  exceedsThreshold: boolean;
};

/**
 * Compute actual vs target allocation given current holdings + the IPS.
 * Holdings are categorized via `tickerCategories`; anything uncategorized
 * surfaces in the `uncategorized` bucket.
 */
export function computeDrift(
  holdings: EnrichedHolding[],
  policy: InvestmentPolicyData,
): {
  rows: AllocationRow[];
  totalMarketValue: number;
  uncategorized: Array<{ ticker: string; marketValue: number }>;
} {
  // Always sum CAD-equivalent so drift percentages are apples-to-apples
  // across mixed-currency holdings. Native `h.marketValue` would conflate
  // USD prices with CAD prices and badly distort the percentage math.
  const totalMarketValue = holdings.reduce(
    (sum, h) => sum + (h.marketValueCad ?? h.costBasisCad),
    0,
  );
  if (totalMarketValue <= 0) {
    return { rows: [], totalMarketValue, uncategorized: [] };
  }

  const actualByCategory = new Map<string, number>();
  const uncategorized: Array<{ ticker: string; marketValue: number }> = [];

  for (const h of holdings) {
    const value = h.marketValueCad ?? h.costBasisCad;
    const category = policy.tickerCategories[h.ticker];
    if (!category) {
      uncategorized.push({ ticker: h.ticker, marketValue: value });
      continue;
    }
    actualByCategory.set(category, (actualByCategory.get(category) ?? 0) + value);
  }

  const categories = new Set<string>([
    ...Object.keys(policy.targetAllocation),
    ...actualByCategory.keys(),
  ]);

  const rows: AllocationRow[] = [];
  for (const category of categories) {
    const targetPct = policy.targetAllocation[category] ?? 0;
    const actualValue = actualByCategory.get(category) ?? 0;
    const actualPct = (actualValue / totalMarketValue) * 100;
    const driftPct = actualPct - targetPct;
    const exceedsThreshold =
      policy.driftThresholdPct != null &&
      Math.abs(driftPct) > policy.driftThresholdPct;
    rows.push({ category, targetPct, actualPct, driftPct, exceedsThreshold });
  }

  rows.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));

  return { rows, totalMarketValue, uncategorized };
}
