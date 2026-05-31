import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { getCandles, getQuotes } from "@/lib/marketdata";
import { sendAlertDigest } from "@/lib/mailgun";
import { getUserPreferences } from "@/lib/preferences";
import { COOLDOWN_MS_BY_RULE, EVALUATORS } from "./rules";
import type { AlertConfig, FiredEvent } from "./types";
import type { Alert, AlertRule, AlertScope, Candle, Prisma } from "@/generated/prisma";
import type { Candle as MarketCandle } from "@/lib/marketdata";

type EvaluateResult = {
  evaluated: number;
  fired: number;
  events: FiredEvent[];
};

const RULES_NEEDING_CANDLES = new Set(["MA_CROSS_50", "MA_CROSS_200", "VOLUME_SPIKE"]);

/** Run all enabled alerts for a single user. Persists fired events. */
export async function evaluateUserAlerts(userId: string): Promise<EvaluateResult> {
  const enabled = await prisma.alert.findMany({
    where: { userId, enabled: true },
  });
  if (enabled.length === 0) return { evaluated: 0, fired: 0, events: [] };

  const portfolio = await getEnrichedPortfolio(userId);

  // Collect every ticker referenced by enabled alerts
  const tickerSet = new Set<string>(portfolio.holdings.map((h) => h.ticker));
  for (const a of enabled) {
    if (a.scope === "TICKER" && a.ticker) tickerSet.add(a.ticker);
  }
  const tickerList = Array.from(tickerSet);

  // Quotes for every relevant ticker (warmed by /api/cron/refresh-quotes)
  const quotes = await getQuotes(tickerList);

  // Candles only when a rule actually needs them
  const needsCandles = enabled.some((a) => RULES_NEEDING_CANDLES.has(a.rule));
  const candles = new Map<string, MarketCandle[]>();
  if (needsCandles && tickerList.length > 0) {
    const results = await Promise.all(
      tickerList.map(async (t) => [t, await getCandles(t, 210)] as const),
    );
    for (const [t, bars] of results) if (bars.length > 0) candles.set(t, bars);
  }

  const ctx = { portfolio, quotes, candles };

  // Evaluate (some are async, e.g. NEWS_MATERIAL)
  const candidateEvents: FiredEvent[] = [];
  for (const row of enabled) {
    const alert = rowToConfig(row);
    const evaluator = EVALUATORS[row.rule];
    if (!evaluator) continue;
    try {
      const result = await evaluator(alert, ctx);
      candidateEvents.push(...result);
    } catch (err) {
      console.error(`[signals] ${row.rule} eval failed for alert ${alert.id}:`, err);
    }
  }

  if (candidateEvents.length === 0) {
    return { evaluated: enabled.length, fired: 0, events: [] };
  }

  // Per-rule cooldown dedup, plus NEWS_MATERIAL handles its own newsId dedup internally
  const fresh = await dedupeAgainstRecent(candidateEvents, enabled);
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

  // Email digest (only when user has it enabled globally + alert has EMAIL channel)
  try {
    const prefs = await getUserPreferences(userId);
    if (prefs.emailDigestEnabled) {
      const emailAlertIds = new Set(
        enabled
          .filter((a) => {
            const channels = Array.isArray(a.channels) ? (a.channels as unknown as string[]) : [];
            return channels.includes("EMAIL");
          })
          .map((a) => a.id),
      );
      const emailEvents = fresh.filter((e) => emailAlertIds.has(e.alertId));
      if (emailEvents.length > 0) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        if (user?.email) {
          await sendAlertDigest({
            email: user.email,
            events: emailEvents.map((e) => ({
              ticker: e.ticker,
              message: e.message,
              firedAt: new Date(),
            })),
          });
        }
      }
    }
  } catch (err) {
    console.error("[signals] alert digest send failed:", err);
  }

  return { evaluated: enabled.length, fired: fresh.length, events: fresh };
}

async function dedupeAgainstRecent(
  candidates: FiredEvent[],
  enabledAlerts: Alert[],
): Promise<FiredEvent[]> {
  const ruleByAlertId = new Map<string, string>();
  for (const a of enabledAlerts) ruleByAlertId.set(a.id, a.rule);

  const byAlert = new Map<string, FiredEvent[]>();
  for (const c of candidates) {
    const arr = byAlert.get(c.alertId) ?? [];
    arr.push(c);
    byAlert.set(c.alertId, arr);
  }

  const out: FiredEvent[] = [];
  for (const [alertId, evs] of byAlert) {
    const rule = ruleByAlertId.get(alertId);
    const cooldown = rule ? (COOLDOWN_MS_BY_RULE[rule] ?? 24 * 3_600_000) : 24 * 3_600_000;
    if (cooldown <= 0) {
      // Rule handles its own dedup — pass through
      out.push(...evs);
      continue;
    }
    const cutoff = new Date(Date.now() - cooldown);
    const recent = await prisma.alertEvent.findMany({
      where: { alertId, firedAt: { gte: cutoff } },
      select: { ticker: true },
    });
    const seenTickers = new Set(recent.map((r) => r.ticker));
    for (const ev of evs) {
      if (seenTickers.has(ev.ticker)) continue;
      out.push(ev);
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
    channels: Array.isArray(a.channels)
      ? ((a.channels as unknown as string[]).filter(
          (c) => c === "IN_APP" || c === "EMAIL",
        ) as ("IN_APP" | "EMAIL")[])
      : ["IN_APP"],
  };
}
