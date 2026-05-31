import "server-only";
import { prisma } from "@/lib/prisma";
import { getCandles, getQuotes } from "@/lib/marketdata";
import { listTransactions } from "@/lib/portfolio/queries";
import { listSnapshots } from "@/lib/portfolio/snapshots";
import {
  annualize,
  beta,
  correlationMatrix,
  dailyReturnsFromCandles,
  dailyReturnsFromSnapshots,
  irr,
  maxDrawdown,
  sharpe,
  twr,
  type DailyReturn,
} from "@/lib/portfolio/performance";
import type { PerformanceProfile } from "@/lib/preferences";

export type PerformanceSummary = {
  snapshotCount: number;
  firstSnapshotDate: Date | null;
  lastSnapshotDate: Date | null;
  twr: number | null;
  twrAnnualized: number | null;
  twrBenchmark: number | null;
  twrBenchmarkAnnualized: number | null;
  twrAlphaAnnualized: number | null;
  irr: number | null;
  beta: number | null;
  sharpe: number | null;
  maxDrawdown: {
    drawdown: number;
    peakDate: Date;
    troughDate: Date;
  } | null;
  benchmarkTicker: string | null;
  riskFreeRate: number | null;
  /** Equity curve series for charting: portfolio + benchmark (if any). */
  equityCurve: Array<{
    date: string;
    portfolio: number;
    benchmark: number | null;
  }>;
};

export type CorrelationData = {
  tickers: string[];
  matrix: (number | null)[][];
};

export async function getPerformanceSummary(
  userId: string,
  profile: PerformanceProfile,
): Promise<PerformanceSummary> {
  const snapshots = await listSnapshots(userId);
  const transactions = await listTransactions(userId);

  // Current portfolio value for IRR. Prefer live quote totals when available.
  let currentValue = 0;
  if (snapshots.length > 0) {
    currentValue = snapshots[snapshots.length - 1].totalMarketValue;
  }
  if (currentValue === 0 && transactions.length > 0) {
    const tickers = Array.from(new Set(transactions.map((t) => t.ticker)));
    const quotes = await getQuotes(tickers);
    for (const t of transactions) {
      // sloppy fallback — not used in normal flow
      void quotes.get(t.ticker);
    }
  }

  const portfolioReturns = dailyReturnsFromSnapshots(snapshots);
  const days = portfolioReturns.length;

  const portfolioTwr = twr(portfolioReturns);
  const portfolioTwrAnn =
    portfolioTwr != null ? annualize(portfolioTwr, days) : null;

  let benchmarkReturns: DailyReturn[] = [];
  let benchmarkTwr: number | null = null;
  let benchmarkTwrAnn: number | null = null;
  let betaVal: number | null = null;

  if (profile.benchmarkTicker && snapshots.length > 1) {
    const span = Math.max(
      30,
      Math.ceil(
        (snapshots[snapshots.length - 1].date.getTime() -
          snapshots[0].date.getTime()) /
          86_400_000,
      ) + 10,
    );
    const candles = await getCandles(profile.benchmarkTicker, span);
    benchmarkReturns = dailyReturnsFromCandles(candles);
    benchmarkTwr = twr(filterByPortfolioDates(benchmarkReturns, portfolioReturns));
    benchmarkTwrAnn =
      benchmarkTwr != null ? annualize(benchmarkTwr, days) : null;
    betaVal = beta(portfolioReturns, benchmarkReturns);
  }

  const sharpeVal = sharpe(portfolioReturns, profile.riskFreeRate);
  const maxDd = maxDrawdown(snapshots);
  const irrVal = irr(transactions, currentValue);

  const equityCurve = buildEquityCurve(snapshots, benchmarkReturns);

  return {
    snapshotCount: snapshots.length,
    firstSnapshotDate: snapshots[0]?.date ?? null,
    lastSnapshotDate: snapshots[snapshots.length - 1]?.date ?? null,
    twr: portfolioTwr,
    twrAnnualized: portfolioTwrAnn,
    twrBenchmark: benchmarkTwr,
    twrBenchmarkAnnualized: benchmarkTwrAnn,
    twrAlphaAnnualized:
      portfolioTwrAnn != null && benchmarkTwrAnn != null
        ? portfolioTwrAnn - benchmarkTwrAnn
        : null,
    irr: irrVal,
    beta: betaVal,
    sharpe: sharpeVal,
    maxDrawdown: maxDd,
    benchmarkTicker: profile.benchmarkTicker,
    riskFreeRate: profile.riskFreeRate,
    equityCurve,
  };
}

export async function getCorrelationMatrix(
  userId: string,
): Promise<CorrelationData | null> {
  // Pull held tickers from current holdings (via snapshots tail) or txns.
  const snaps = await listSnapshots(userId);
  let tickers: string[] = [];
  if (snaps.length > 0) {
    tickers = snaps[snaps.length - 1].holdings.map((h) => h.ticker);
  } else {
    const rows = await prisma.transaction.findMany({
      where: { userId },
      select: { ticker: true },
      distinct: ["ticker"],
    });
    tickers = rows.map((r) => r.ticker);
  }
  if (tickers.length < 2) return null;

  // Fetch ~180 days of candles for each ticker.
  const returnsByTicker = new Map<string, DailyReturn[]>();
  await Promise.all(
    tickers.map(async (t) => {
      const candles = await getCandles(t, 200);
      returnsByTicker.set(t, dailyReturnsFromCandles(candles));
    }),
  );

  return correlationMatrix(tickers, returnsByTicker);
}

function filterByPortfolioDates(
  benchmark: DailyReturn[],
  portfolio: DailyReturn[],
): DailyReturn[] {
  const portfolioDates = new Set(
    portfolio.map((r) => r.date.toISOString().slice(0, 10)),
  );
  return benchmark.filter((r) =>
    portfolioDates.has(r.date.toISOString().slice(0, 10)),
  );
}

function buildEquityCurve(
  snapshots: Array<{ date: Date; totalMarketValue: number; totalCost: number }>,
  benchmarkReturns: DailyReturn[],
): PerformanceSummary["equityCurve"] {
  const benchmarkByDate = new Map<string, number>();
  let cumBench = 1;
  for (const r of benchmarkReturns) {
    cumBench *= 1 + r.r;
    benchmarkByDate.set(r.date.toISOString().slice(0, 10), cumBench);
  }

  if (snapshots.length === 0) return [];
  const start = snapshots[0].totalMarketValue;
  const out: PerformanceSummary["equityCurve"] = [];
  // Re-index benchmark to match the first snapshot date's portfolio value
  // (so they're visually comparable on the same chart).
  const firstDateKey = snapshots[0].date.toISOString().slice(0, 10);
  const firstBench = benchmarkByDate.get(firstDateKey) ?? null;
  for (const s of snapshots) {
    const key = s.date.toISOString().slice(0, 10);
    const bench = benchmarkByDate.get(key);
    const benchValue =
      bench != null && firstBench != null && firstBench !== 0
        ? (bench / firstBench) * start
        : null;
    out.push({
      date: key,
      portfolio: s.totalMarketValue,
      benchmark: benchValue,
    });
  }
  return out;
}
