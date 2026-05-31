import "server-only";
import { formatPercent, formatCurrency } from "@/lib/format";
import type { EnrichedHolding, EnrichedPortfolio } from "@/lib/portfolio/types";
import type { Quote } from "@/lib/marketdata";
import type { AlertConfig, AlertParams, FiredEvent } from "./types";

export type RuleContext = {
  portfolio: EnrichedPortfolio;
  quotes: Map<string, Quote>;
};

/**
 * Pure rule evaluators — each returns an array of fresh events to fire for a
 * given alert. Cooldown/deduplication is handled by the caller in evaluate.ts.
 */

export function evaluatePriceMove(
  alert: AlertConfig,
  ctx: RuleContext,
): FiredEvent[] {
  const params = alert.params as AlertParams["PRICE_MOVE"];
  const tickers = resolveTickers(alert, ctx);
  const events: FiredEvent[] = [];

  for (const ticker of tickers) {
    const quote = ctx.quotes.get(ticker);
    if (!quote) continue;
    const absChange = Math.abs(quote.changePct);
    if (absChange < params.thresholdPct) continue;

    const direction = quote.changePct >= 0 ? "up" : "down";
    events.push({
      alertId: alert.id,
      userId: alert.userId,
      ticker,
      message: `${ticker} ${direction} ${formatPercent(quote.changePct)} today (now ${formatCurrency(quote.price)})`,
      data: {
        ticker,
        price: quote.price,
        change: quote.change,
        changePct: quote.changePct,
        thresholdPct: params.thresholdPct,
        asOf: quote.asOf,
      },
    });
  }

  return events;
}

export function evaluateDrawdown(
  alert: AlertConfig,
  ctx: RuleContext,
): FiredEvent[] {
  const params = alert.params as AlertParams["DRAWDOWN"];
  const tickers = resolveTickers(alert, ctx);
  const events: FiredEvent[] = [];

  for (const ticker of tickers) {
    const holding = ctx.portfolio.holdings.find((h) => h.ticker === ticker);
    if (!holding || holding.avgCost <= 0 || holding.marketPrice == null) continue;

    const drawdownPct = ((holding.marketPrice - holding.avgCost) / holding.avgCost) * 100;
    if (drawdownPct > -params.thresholdPct) continue;

    events.push({
      alertId: alert.id,
      userId: alert.userId,
      ticker,
      message: `${ticker} is ${formatPercent(drawdownPct)} from your avg cost of ${formatCurrency(holding.avgCost)} (now ${formatCurrency(holding.marketPrice)})`,
      data: {
        ticker,
        currentPrice: holding.marketPrice,
        avgCost: holding.avgCost,
        drawdownPct,
        thresholdPct: params.thresholdPct,
      },
    });
  }

  return events;
}

export function evaluateConcentration(
  alert: AlertConfig,
  ctx: RuleContext,
): FiredEvent[] {
  const params = alert.params as AlertParams["CONCENTRATION"];
  if (!ctx.portfolio.hasAnyQuote || ctx.portfolio.totalMarketValue <= 0) return [];

  const events: FiredEvent[] = [];
  for (const h of ctx.portfolio.holdings) {
    if (h.marketValue == null) continue;
    const weight = (h.marketValue / ctx.portfolio.totalMarketValue) * 100;
    if (weight < params.thresholdPct) continue;

    events.push({
      alertId: alert.id,
      userId: alert.userId,
      ticker: h.ticker,
      message: `${h.ticker} is ${weight.toFixed(1)}% of your portfolio (threshold ${params.thresholdPct}%)`,
      data: {
        ticker: h.ticker,
        weight,
        marketValue: h.marketValue,
        totalMarketValue: ctx.portfolio.totalMarketValue,
        thresholdPct: params.thresholdPct,
      },
    });
  }

  return events;
}

function resolveTickers(alert: AlertConfig, ctx: RuleContext): string[] {
  switch (alert.scope) {
    case "TICKER":
      return alert.ticker ? [alert.ticker] : [];
    case "HOLDING":
      return ctx.portfolio.holdings.map((h) => h.ticker);
    case "PORTFOLIO":
      return ctx.portfolio.holdings.map((h) => h.ticker);
  }
}

// Used for typed dispatch
export type RuleEvaluator = (alert: AlertConfig, ctx: RuleContext) => FiredEvent[];

export const EVALUATORS: Record<string, RuleEvaluator> = {
  PRICE_MOVE: evaluatePriceMove,
  DRAWDOWN: evaluateDrawdown,
  CONCENTRATION: evaluateConcentration,
};

// Used elsewhere — re-export from types.ts via this file for consumer ergonomics
export type { EnrichedHolding };
