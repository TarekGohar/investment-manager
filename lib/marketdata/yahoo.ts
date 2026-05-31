import "server-only";
import YahooFinance from "yahoo-finance2";
import type { Candle } from "./types";

const yf = new YahooFinance();

type IntradayInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "90m";
type AnyInterval = "1d" | "1wk" | "1mo" | IntradayInterval;

type Quote = {
  date: Date | string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

async function fetchChart(
  symbol: string,
  period1: Date,
  period2: Date,
  interval: AnyInterval,
): Promise<Candle[]> {
  const result = (await yf.chart(symbol.toUpperCase(), {
    period1,
    period2,
    interval,
  })) as { quotes: Quote[] };

  return result.quotes
    .filter((q) => q.close != null && q.date)
    .map((q) => ({
      ts: new Date(q.date as Date | string),
      open: q.open ?? q.close ?? 0,
      high: q.high ?? q.close ?? 0,
      low: q.low ?? q.close ?? 0,
      close: q.close as number,
      volume: q.volume ?? 0,
    }));
}

/** Daily bars going back `days` days. */
export function fetchCandlesYahoo(symbol: string, days = 180): Promise<Candle[]> {
  const period1 = new Date(Date.now() - days * 86_400_000);
  const period2 = new Date();
  return fetchChart(symbol, period1, period2, "1d");
}

/** 5-minute bars covering the last ~3 days (gets us today's session). */
export function fetchIntraday1D(symbol: string): Promise<Candle[]> {
  const period1 = new Date(Date.now() - 3 * 86_400_000);
  const period2 = new Date();
  return fetchChart(symbol, period1, period2, "5m");
}

/** 30-minute bars covering the last ~7 days. */
export function fetchIntraday1W(symbol: string): Promise<Candle[]> {
  const period1 = new Date(Date.now() - 8 * 86_400_000);
  const period2 = new Date();
  return fetchChart(symbol, period1, period2, "30m");
}
