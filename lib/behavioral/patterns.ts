import "server-only";
import { prisma } from "@/lib/prisma";
import { getCandles } from "@/lib/marketdata";
import { listTransactions } from "@/lib/portfolio/queries";
import { getInvestmentPolicy } from "@/lib/policy/ips";

export type BehavioralFlag =
  | {
      kind: "PANIC_SELL";
      transactionId: string;
      ticker: string;
      occurredAt: Date;
      drawdownPct: number;
      drawdownWindowDays: number;
    }
  | {
      kind: "FOMO_BUY";
      transactionId: string;
      ticker: string;
      occurredAt: Date;
      runupPct: number;
      runupWindowDays: number;
    }
  | {
      kind: "OVERTRADING";
      yearMonth: string; // "2026-04"
      tradeCount: number;
      threshold: number;
    };

export type BehavioralReport = {
  flags: BehavioralFlag[];
  /** Which checks ran. Lets the UI explain why others didn't. */
  ranChecks: {
    panicSell: boolean;
    fomoBuy: boolean;
    overtrading: boolean;
  };
};

/**
 * Detect behavioral patterns across the user's transaction history. Each
 * check is *only* run when the user has supplied the necessary thresholds
 * in their IPS. Missing threshold = check disabled, never assumed.
 */
export async function detectBehavioralPatterns(
  userId: string,
): Promise<BehavioralReport> {
  const ips = await getInvestmentPolicy(userId);
  const transactions = await listTransactions(userId);

  const flags: BehavioralFlag[] = [];

  const panicSellEnabled =
    ips.panicSellDrawdownPct != null && ips.panicSellWindowDays != null;
  const fomoBuyEnabled =
    ips.fomoBuyRunupPct != null && ips.fomoBuyWindowDays != null;
  const overtradingEnabled = ips.overtradingPerMonth != null;

  if (panicSellEnabled || fomoBuyEnabled) {
    const tickers = Array.from(new Set(transactions.map((t) => t.ticker)));
    // Load enough candle history to look back from any transaction date.
    const maxWindow = Math.max(
      ips.panicSellWindowDays ?? 0,
      ips.fomoBuyWindowDays ?? 0,
    );
    const lookbackDays = Math.max(60, maxWindow * 3);
    const candlesByTicker = new Map<string, { ts: Date; close: number }[]>();
    for (const t of tickers) {
      const candles = await getCandles(t, lookbackDays + 30);
      candlesByTicker.set(
        t,
        candles.map((c) => ({ ts: c.ts, close: c.close })),
      );
    }

    for (const tx of transactions) {
      if (tx.kind === "SELL" && panicSellEnabled) {
        const series = candlesByTicker.get(tx.ticker);
        if (!series || series.length === 0) continue;
        const window = priceWindow(series, tx.occurredAt, ips.panicSellWindowDays!);
        if (!window) continue;
        // Drawdown = (sale price - window high) / window high
        const dd = ((window.atTradePrice ?? tx.price) - window.high) / window.high;
        if (dd <= -(ips.panicSellDrawdownPct! / 100)) {
          flags.push({
            kind: "PANIC_SELL",
            transactionId: tx.id,
            ticker: tx.ticker,
            occurredAt: tx.occurredAt,
            drawdownPct: dd * 100,
            drawdownWindowDays: ips.panicSellWindowDays!,
          });
        }
      } else if (tx.kind === "BUY" && fomoBuyEnabled) {
        const series = candlesByTicker.get(tx.ticker);
        if (!series || series.length === 0) continue;
        const window = priceWindow(series, tx.occurredAt, ips.fomoBuyWindowDays!);
        if (!window) continue;
        // Runup = (buy price - window low) / window low
        const runup = ((window.atTradePrice ?? tx.price) - window.low) / window.low;
        if (runup >= ips.fomoBuyRunupPct! / 100) {
          flags.push({
            kind: "FOMO_BUY",
            transactionId: tx.id,
            ticker: tx.ticker,
            occurredAt: tx.occurredAt,
            runupPct: runup * 100,
            runupWindowDays: ips.fomoBuyWindowDays!,
          });
        }
      }
    }
  }

  if (overtradingEnabled) {
    const monthCounts = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.kind !== "BUY" && tx.kind !== "SELL") continue;
      const ym = `${tx.occurredAt.getUTCFullYear()}-${String(tx.occurredAt.getUTCMonth() + 1).padStart(2, "0")}`;
      monthCounts.set(ym, (monthCounts.get(ym) ?? 0) + 1);
    }
    for (const [ym, count] of monthCounts) {
      if (count > ips.overtradingPerMonth!) {
        flags.push({
          kind: "OVERTRADING",
          yearMonth: ym,
          tradeCount: count,
          threshold: ips.overtradingPerMonth!,
        });
      }
    }
  }

  flags.sort((a, b) => {
    const ad = "occurredAt" in a ? a.occurredAt.getTime() : 0;
    const bd = "occurredAt" in b ? b.occurredAt.getTime() : 0;
    return bd - ad;
  });

  return {
    flags,
    ranChecks: {
      panicSell: panicSellEnabled,
      fomoBuy: fomoBuyEnabled,
      overtrading: overtradingEnabled,
    },
  };
}

/**
 * Returns the window-high and window-low closes in the N days leading up to
 * `tradeDate`, plus the close on `tradeDate` if available. Window is
 * [tradeDate - N, tradeDate).
 */
function priceWindow(
  series: { ts: Date; close: number }[],
  tradeDate: Date,
  windowDays: number,
): { high: number; low: number; atTradePrice: number | null } | null {
  const tradeMs = tradeDate.getTime();
  const fromMs = tradeMs - windowDays * 86_400_000;
  let high = -Infinity;
  let low = Infinity;
  let atTradePrice: number | null = null;
  for (const c of series) {
    const t = c.ts.getTime();
    if (t < fromMs) continue;
    if (t > tradeMs) break;
    if (t === tradeMs || (atTradePrice == null && t > tradeMs - 86_400_000)) {
      atTradePrice = c.close;
    }
    if (t < tradeMs) {
      if (c.close > high) high = c.close;
      if (c.close < low) low = c.close;
    }
  }
  if (high === -Infinity || low === Infinity) return null;
  return { high, low, atTradePrice };
}

/** Lightweight version used by AI tool — same data plus the IPS so the
 *  assistant can explain which thresholds the user has configured. */
export async function getBehavioralPatternsWithPolicy(userId: string) {
  const [report, ips] = await Promise.all([
    detectBehavioralPatterns(userId),
    prisma.investmentPolicy.findUnique({ where: { userId } }),
  ]);
  return {
    report,
    thresholds: {
      panicSellDrawdownPct: ips?.panicSellDrawdownPct?.toNumber() ?? null,
      panicSellWindowDays: ips?.panicSellWindowDays ?? null,
      fomoBuyRunupPct: ips?.fomoBuyRunupPct?.toNumber() ?? null,
      fomoBuyWindowDays: ips?.fomoBuyWindowDays ?? null,
      overtradingPerMonth: ips?.overtradingPerMonth ?? null,
    },
  };
}
