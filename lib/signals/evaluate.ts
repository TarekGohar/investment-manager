import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { getQuotes } from "@/lib/marketdata";
import { EVALUATORS } from "./rules";
import type { AlertConfig, FiredEvent } from "./types";
import type { Alert, AlertRule, AlertScope, Prisma } from "@/generated/prisma";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h per (alert, ticker)

type EvaluateResult = {
  evaluated: number;
  fired: number;
  events: FiredEvent[];
};

/** Run all enabled alerts for a single user. Persists fired events. */
export async function evaluateUserAlerts(userId: string): Promise<EvaluateResult> {
  const enabled = await prisma.alert.findMany({
    where: { userId, enabled: true },
  });
  if (enabled.length === 0) return { evaluated: 0, fired: 0, events: [] };

  const portfolio = await getEnrichedPortfolio(userId);
  // Make sure we have quotes for every held ticker + every TICKER-scoped alert
  const tickerSet = new Set<string>(portfolio.holdings.map((h) => h.ticker));
  for (const a of enabled) {
    if (a.scope === "TICKER" && a.ticker) tickerSet.add(a.ticker);
  }
  const quotes = await getQuotes(Array.from(tickerSet));

  const ctx = { portfolio, quotes };

  const candidateEvents: FiredEvent[] = [];
  for (const row of enabled) {
    const alert = rowToConfig(row);
    const evaluator = EVALUATORS[row.rule];
    if (!evaluator) continue;
    candidateEvents.push(...evaluator(alert, ctx));
  }

  if (candidateEvents.length === 0) {
    return { evaluated: enabled.length, fired: 0, events: [] };
  }

  // Filter against cooldown — don't re-fire same (alert, ticker) within window
  const fresh = await dedupeAgainstRecent(candidateEvents);
  if (fresh.length === 0) {
    return { evaluated: enabled.length, fired: 0, events: [] };
  }

  await prisma.alertEvent.createMany({
    data: fresh.map((e) => ({
      alertId: e.alertId,
      userId: e.userId,
      ticker: e.ticker,
      message: e.message,
      data: e.data as Prisma.InputJsonValue,
    })),
  });

  return { evaluated: enabled.length, fired: fresh.length, events: fresh };
}

async function dedupeAgainstRecent(candidates: FiredEvent[]): Promise<FiredEvent[]> {
  const cutoff = new Date(Date.now() - COOLDOWN_MS);
  const out: FiredEvent[] = [];

  // Group lookups by alert to minimize round trips
  const byAlert = new Map<string, FiredEvent[]>();
  for (const c of candidates) {
    const arr = byAlert.get(c.alertId) ?? [];
    arr.push(c);
    byAlert.set(c.alertId, arr);
  }

  for (const [alertId, evs] of byAlert) {
    const recent = await prisma.alertEvent.findMany({
      where: { alertId, firedAt: { gte: cutoff } },
      select: { ticker: true },
    });
    const seenTickers = new Set(recent.map((r) => r.ticker));
    for (const ev of evs) {
      if (seenTickers.has(ev.ticker)) continue;
      out.push(ev);
      // Prevent dupes within this batch too
      seenTickers.add(ev.ticker);
    }
  }

  return out;
}

function rowToConfig(a: Alert): AlertConfig {
  return {
    id: a.id,
    userId: a.userId,
    rule: a.rule as AlertRule,
    scope: a.scope as AlertScope,
    ticker: a.ticker,
    params: (a.params as Record<string, unknown>) ?? {},
    enabled: a.enabled,
    channels: Array.isArray(a.channels) ? (a.channels as string[]).filter((c) => c === "IN_APP" || c === "EMAIL") as ("IN_APP" | "EMAIL")[] : ["IN_APP"],
  };
}
