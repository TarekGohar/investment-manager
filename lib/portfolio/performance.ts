import "server-only";
import type { Tx } from "./types";
import type { PortfolioSnapshotRow } from "./snapshots";

/**
 * Performance + risk math. Pure functions on (snapshots, transactions,
 * benchmark candles, risk-free rate). Nothing is assumed — when an input
 * is missing (e.g. no benchmark ticker), the corresponding metric returns
 * null and callers must show "set your performance profile" CTA rather
 * than fabricating a number.
 */

export type DailyReturn = { date: Date; r: number };

/** Convert a snapshot series to daily returns based on totalMarketValue,
 *  netting out external cash flows IN and OUT of positions between days.
 *
 *  Flows are derived from `transactions`, not snapshot cost-basis diffs.
 *  Inflows to positions (BUY, TRANSFER_IN, DRIP) increase the denominator
 *  and are subtracted from the numerator. Outflows from positions (SELL,
 *  TRANSFER_OUT) are subtracted from the numerator (negative `netFlow`).
 *  DIVIDEND received goes to cash, not positions, so it isn't a flow here.
 *
 *  The earlier inference-from-totalCost approach broke in two ways: SELLS
 *  were never subtracted (Math.max(0, …) zeroed them), making sell days
 *  look like negative-return days; and the "DRIP-as-external" treatment
 *  systematically biased TWR downward on portfolios with reinvested
 *  dividends. Both effects compound across a year to a several-percent
 *  understatement vs IRR.
 */
export function dailyReturnsFromSnapshots(
  snapshots: PortfolioSnapshotRow[],
  transactions: Tx[],
): DailyReturn[] {
  // Bucket flows by ISO date (UTC). Snapshot dates are start-of-UTC-day, so
  // a flow whose `occurredAt` falls in day D contributes to the return
  // between snapshots[D-1] and snapshots[D].
  const flowsByIso = new Map<string, number>();
  for (const tx of transactions) {
    const iso = tx.occurredAt.toISOString().slice(0, 10);
    let flow = 0;
    if (tx.kind === "BUY" || tx.kind === "TRANSFER_IN") {
      flow = tx.quantity * tx.price + tx.fees;
    } else if (tx.kind === "SELL" || tx.kind === "TRANSFER_OUT") {
      flow = -(tx.quantity * tx.price - tx.fees);
    }
    // DIVIDEND, SPLIT, etc. are not external flows to positions.
    if (flow !== 0) {
      flowsByIso.set(iso, (flowsByIso.get(iso) ?? 0) + flow);
    }
  }

  const out: DailyReturn[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const cur = snapshots[i];
    // Sum flows that occurred AFTER prev.date through cur.date.
    let netFlow = 0;
    const startMs = prev.date.getTime();
    const endMs = cur.date.getTime();
    for (const [iso, f] of flowsByIso) {
      const t = Date.parse(iso + "T00:00:00.000Z");
      if (t > startMs && t <= endMs) netFlow += f;
    }
    const denom = prev.totalMarketValue + Math.max(0, netFlow);
    if (denom <= 0) continue;
    const r = (cur.totalMarketValue - prev.totalMarketValue - netFlow) / denom;
    out.push({ date: cur.date, r });
  }
  return out;
}

/**
 * Time-weighted return (TWR) over the full series — geometric chain of
 * daily returns. Returned as a decimal (0.123 = 12.3%).
 */
export function twr(returns: DailyReturn[]): number | null {
  if (returns.length === 0) return null;
  let growth = 1;
  for (const r of returns) growth *= 1 + r.r;
  return growth - 1;
}

/**
 * Annualize a cumulative return given the number of trading days observed.
 * 252 trading days per year is the convention for North American markets.
 */
export function annualize(cumulativeReturn: number, days: number): number | null {
  if (days <= 0) return null;
  return Math.pow(1 + cumulativeReturn, 252 / days) - 1;
}

/**
 * Money-weighted return (IRR) over the transaction history + current value.
 * Cash flows are user contributions (BUY * shares + fees, +TRANSFER_IN at FMV)
 * and withdrawals (SELL net proceeds, +TRANSFER_OUT at deemed FMV). Final
 * "cash flow" is current portfolio value treated as a return-of-capital at
 * `asOf`. Newton-Raphson with bisection fallback.
 *
 * Returns annualized IRR as a decimal. Returns null if unsolvable.
 */
export function irr(
  transactions: Tx[],
  currentValue: number,
  asOf: Date = new Date(),
): number | null {
  if (currentValue < 0) return null;
  type Flow = { t: number; amount: number };
  const flows: Flow[] = [];
  const refTime = asOf.getTime();
  for (const tx of transactions) {
    const t = (tx.occurredAt.getTime() - refTime) / (365.25 * 86_400_000);
    if (tx.kind === "BUY" || tx.kind === "TRANSFER_IN") {
      flows.push({ t, amount: -(tx.quantity * tx.price + tx.fees) });
    } else if (tx.kind === "SELL" || tx.kind === "TRANSFER_OUT") {
      flows.push({ t, amount: tx.quantity * tx.price - tx.fees });
    } else if (tx.kind === "DIVIDEND") {
      flows.push({ t, amount: tx.price });
    }
  }
  flows.push({ t: 0, amount: currentValue });
  if (flows.length < 2) return null;

  const npv = (r: number) =>
    flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + r, f.t), 0);

  // Bisection between -0.99 and 5 (= -99% to +500% annual)
  let lo = -0.99;
  let hi = 5;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (Number.isNaN(fLo) || Number.isNaN(fHi)) return null;
  if (fLo * fHi > 0) return null; // no sign change → no root in range
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Beta of a return series against a benchmark return series, aligned by date.
 * Returns null if there's not enough overlap (<10 days).
 */
export function beta(
  portfolio: DailyReturn[],
  benchmark: DailyReturn[],
): number | null {
  const aligned = alignReturns(portfolio, benchmark);
  if (aligned.length < 10) return null;
  const pMean = mean(aligned.map((a) => a.p));
  const bMean = mean(aligned.map((a) => a.b));
  let covar = 0;
  let bVar = 0;
  for (const a of aligned) {
    covar += (a.p - pMean) * (a.b - bMean);
    bVar += (a.b - bMean) ** 2;
  }
  if (bVar === 0) return null;
  return covar / bVar;
}

/**
 * Sharpe ratio — (annualized portfolio return - annualized risk-free rate)
 * over annualized volatility. Risk-free rate must be supplied by the caller.
 * Returns null if rfr is missing or there's no usable return series.
 */
export function sharpe(
  returns: DailyReturn[],
  annualRiskFreeRate: number | null,
): number | null {
  if (annualRiskFreeRate == null) return null;
  if (returns.length < 10) return null;
  const dailyRf = annualRiskFreeRate / 252;
  const excess = returns.map((r) => r.r - dailyRf);
  const m = mean(excess);
  const sd = stdev(excess);
  if (sd === 0) return null;
  // Annualize: mean *252, vol * sqrt(252)
  return (m * 252) / (sd * Math.sqrt(252));
}

/**
 * Max drawdown — largest peak-to-trough decline of `totalMarketValue` in the
 * snapshot series, returned as a negative decimal. Also reports peak and
 * trough dates.
 */
export function maxDrawdown(snapshots: PortfolioSnapshotRow[]): {
  drawdown: number;
  peakDate: Date;
  troughDate: Date;
} | null {
  if (snapshots.length < 2) return null;
  let peak = snapshots[0].totalMarketValue;
  let peakDate = snapshots[0].date;
  let maxDd = 0;
  let ddPeakDate = peakDate;
  let ddTroughDate = peakDate;
  for (const s of snapshots) {
    if (s.totalMarketValue > peak) {
      peak = s.totalMarketValue;
      peakDate = s.date;
    }
    if (peak > 0) {
      const dd = (s.totalMarketValue - peak) / peak;
      if (dd < maxDd) {
        maxDd = dd;
        ddPeakDate = peakDate;
        ddTroughDate = s.date;
      }
    }
  }
  if (maxDd === 0) return null;
  return { drawdown: maxDd, peakDate: ddPeakDate, troughDate: ddTroughDate };
}

/**
 * Pairwise correlation matrix between tickers using their daily-return
 * series. `returnsByTicker` is a map from ticker → DailyReturn[]. Returns
 * a square matrix in `tickers` order; the diagonal is 1.
 */
export function correlationMatrix(
  tickers: string[],
  returnsByTicker: Map<string, DailyReturn[]>,
): { tickers: string[]; matrix: (number | null)[][] } {
  const n = tickers.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const a = returnsByTicker.get(tickers[i]) ?? [];
      const b = returnsByTicker.get(tickers[j]) ?? [];
      const aligned = alignReturns(a, b);
      if (aligned.length < 10) continue;
      const aMean = mean(aligned.map((x) => x.p));
      const bMean = mean(aligned.map((x) => x.b));
      let num = 0;
      let aSs = 0;
      let bSs = 0;
      for (const x of aligned) {
        num += (x.p - aMean) * (x.b - bMean);
        aSs += (x.p - aMean) ** 2;
        bSs += (x.b - bMean) ** 2;
      }
      const denom = Math.sqrt(aSs * bSs);
      const corr = denom === 0 ? null : num / denom;
      matrix[i][j] = corr;
      matrix[j][i] = corr;
    }
  }
  return { tickers, matrix };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function alignReturns(
  p: DailyReturn[],
  b: DailyReturn[],
): Array<{ p: number; b: number }> {
  const bByDate = new Map<string, number>();
  for (const x of b) bByDate.set(toKey(x.date), x.r);
  const out: Array<{ p: number; b: number }> = [];
  for (const x of p) {
    const v = bByDate.get(toKey(x.date));
    if (v != null) out.push({ p: x.r, b: v });
  }
  return out;
}

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * Daily returns from a Candle close series. Used for the benchmark + the
 * correlation matrix.
 */
export function dailyReturnsFromCandles(
  candles: Array<{ ts: Date; close: number }>,
): DailyReturn[] {
  const out: DailyReturn[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const cur = candles[i].close;
    if (prev <= 0) continue;
    out.push({ date: candles[i].ts, r: (cur - prev) / prev });
  }
  return out;
}
