import "server-only";
import { prisma } from "@/lib/prisma";
import { formatPercent, formatCurrency } from "@/lib/format";
import type { EnrichedHolding, EnrichedPortfolio } from "@/lib/portfolio/types";
import type { Candle, Quote } from "@/lib/marketdata";
import type { AlertConfig, AlertParams, FiredEvent } from "./types";

export type RuleContext = {
  portfolio: EnrichedPortfolio;
  quotes: Map<string, Quote>;
  /** Daily candles, oldest first. Only present for tickers referenced by enabled alerts. */
  candles: Map<string, Candle[]>;
};

/**
 * Pure rule evaluators — each returns events to fire for a given alert.
 * Cooldown / deduplication is handled by the caller in evaluate.ts.
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
    if (Math.abs(quote.changePct) < params.thresholdPct) continue;

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
    if (!holding || holding.acb <= 0 || holding.marketPrice == null) continue;

    const drawdownPct = ((holding.marketPrice - holding.acb) / holding.acb) * 100;
    if (drawdownPct > -params.thresholdPct) continue;

    events.push({
      alertId: alert.id,
      userId: alert.userId,
      ticker,
      message: `${ticker} is ${formatPercent(drawdownPct)} from your ACB of ${formatCurrency(holding.acb)} (now ${formatCurrency(holding.marketPrice)})`,
      data: {
        ticker,
        currentPrice: holding.marketPrice,
        acb: holding.acb,
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

function evaluateMACrossAt(
  alert: AlertConfig,
  ctx: RuleContext,
  period: number,
): FiredEvent[] {
  const tickers = resolveTickers(alert, ctx);
  const events: FiredEvent[] = [];

  for (const ticker of tickers) {
    const candles = ctx.candles.get(ticker);
    if (!candles || candles.length < period + 1) continue;

    const lastIdx = candles.length - 1;
    const today = candles[lastIdx];
    const yesterday = candles[lastIdx - 1];

    const todayMA = sma(candles, lastIdx, period);
    const yesterdayMA = sma(candles, lastIdx - 1, period);
    if (todayMA == null || yesterdayMA == null) continue;

    const todayDelta = today.close - todayMA;
    const yesterdayDelta = yesterday.close - yesterdayMA;

    // Cross only when sign flipped
    if (Math.sign(todayDelta) === Math.sign(yesterdayDelta)) continue;
    if (todayDelta === 0) continue;

    const direction = todayDelta > 0 ? "above" : "below";
    events.push({
      alertId: alert.id,
      userId: alert.userId,
      ticker,
      message: `${ticker} closed ${direction} its ${period}-day MA (close ${formatCurrency(today.close)}, MA ${formatCurrency(todayMA)})`,
      data: {
        ticker,
        period,
        close: today.close,
        ma: todayMA,
        direction,
      },
    });
  }

  return events;
}

export function evaluateMACross50(alert: AlertConfig, ctx: RuleContext): FiredEvent[] {
  return evaluateMACrossAt(alert, ctx, 50);
}

export function evaluateMACross200(alert: AlertConfig, ctx: RuleContext): FiredEvent[] {
  return evaluateMACrossAt(alert, ctx, 200);
}

export function evaluateVolumeSpike(
  alert: AlertConfig,
  ctx: RuleContext,
): FiredEvent[] {
  const params = alert.params as AlertParams["VOLUME_SPIKE"];
  const tickers = resolveTickers(alert, ctx);
  const events: FiredEvent[] = [];

  for (const ticker of tickers) {
    const candles = ctx.candles.get(ticker);
    if (!candles || candles.length < 31) continue;

    const today = candles[candles.length - 1];
    const past = candles.slice(-31, -1);
    const avg = past.reduce((s, c) => s + c.volume, 0) / past.length;
    if (avg <= 0 || today.volume <= 0) continue;

    const ratio = today.volume / avg;
    if (ratio < params.multipleX) continue;

    events.push({
      alertId: alert.id,
      userId: alert.userId,
      ticker,
      message: `${ticker} volume is ${ratio.toFixed(1)}× the 30-day average`,
      data: {
        ticker,
        todayVolume: today.volume,
        avgVolume: avg,
        ratio,
        multipleX: params.multipleX,
      },
    });
  }

  return events;
}

export async function evaluateNewsMaterial(
  alert: AlertConfig,
  ctx: RuleContext,
): Promise<FiredEvent[]> {
  const tickers = resolveTickers(alert, ctx);
  if (tickers.length === 0) return [];

  // Look back 24h for freshly-classified material/critical news
  const since = new Date(Date.now() - 24 * 3_600_000);
  const items = await prisma.newsItem.findMany({
    where: {
      ticker: { in: tickers },
      aiSeverity: { in: ["MATERIAL", "CRITICAL"] },
      publishedAt: { gte: since },
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  // Dedup by (ticker, newsId) across recent events
  const lookback = new Date(Date.now() - 24 * 3_600_000);
  const priorEvents = await prisma.alertEvent.findMany({
    where: {
      alertId: alert.id,
      firedAt: { gte: lookback },
    },
    select: { data: true },
  });
  const firedNewsIds = new Set<string>();
  for (const ev of priorEvents) {
    const newsId =
      ev.data && typeof ev.data === "object" && "newsId" in (ev.data as Record<string, unknown>)
        ? String((ev.data as Record<string, unknown>).newsId)
        : null;
    if (newsId) firedNewsIds.add(newsId);
  }

  const events: FiredEvent[] = [];
  for (const item of items) {
    if (firedNewsIds.has(item.id)) continue;
    firedNewsIds.add(item.id); // prevent intra-batch dupes
    events.push({
      alertId: alert.id,
      userId: alert.userId,
      ticker: item.ticker,
      message: `[${item.aiSeverity}] ${item.ticker}: ${item.headline}`,
      data: {
        newsId: item.id,
        ticker: item.ticker,
        severity: item.aiSeverity,
        headline: item.headline,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
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
    case "PORTFOLIO":
      return ctx.portfolio.holdings.map((h) => h.ticker);
  }
}

function sma(candles: Candle[], idx: number, period: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += candles[i].close;
  return sum / period;
}

export type RuleEvaluator = (
  alert: AlertConfig,
  ctx: RuleContext,
) => FiredEvent[] | Promise<FiredEvent[]>;

export const EVALUATORS: Record<string, RuleEvaluator> = {
  PRICE_MOVE: evaluatePriceMove,
  DRAWDOWN: evaluateDrawdown,
  CONCENTRATION: evaluateConcentration,
  MA_CROSS_50: evaluateMACross50,
  MA_CROSS_200: evaluateMACross200,
  VOLUME_SPIKE: evaluateVolumeSpike,
  NEWS_MATERIAL: evaluateNewsMaterial,
};

/** Rule-specific cooldown windows for the (alertId, ticker) dedup pass. */
export const COOLDOWN_MS_BY_RULE: Record<string, number> = {
  PRICE_MOVE: 24 * 3_600_000,
  DRAWDOWN: 24 * 3_600_000,
  CONCENTRATION: 24 * 3_600_000,
  MA_CROSS_50: 7 * 24 * 3_600_000,
  MA_CROSS_200: 14 * 24 * 3_600_000,
  VOLUME_SPIKE: 24 * 3_600_000,
  // NEWS_MATERIAL dedupes on news ID inside the evaluator; no extra cooldown needed
  NEWS_MATERIAL: 0,
};

export type { EnrichedHolding };
