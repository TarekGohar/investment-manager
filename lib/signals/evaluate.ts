import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { getCandles, getQuotes } from "@/lib/marketdata";
import { sendAlertDigest } from "@/lib/email";
import { getUserPreferences } from "@/lib/preferences";
import { COOLDOWN_MS_BY_RULE, EVALUATORS } from "./rules";
import { runTlhWatch } from "@/lib/coaching/tlh-watch";
import { runRebalanceWatch } from "@/lib/coaching/rebalance-watch";
import type { AlertConfig, FiredEvent } from "./types";
import type { Alert, AlertRule, AlertScope, Candle, Prisma } from "@/generated/prisma";
import type { Candle as MarketCandle } from "@/lib/marketdata";

type EvaluateResult = {
  evaluated: number;
  fired: number;
  events: FiredEvent[];
};

const RULES_NEEDING_CANDLES = new Set(["MA_CROSS_50", "MA_CROSS_200", "VOLUME_SPIKE"]);

/**
 * Rules that count as "material" for the `silentUnlessMaterial` preference.
 * Anything firing on these rules earns its way into the email digest by
 * default. Low-signal rules (PRICE_MOVE, MA_CROSS, VOLUME_SPIKE, routine
 * DRAWDOWN, CONCENTRATION) still write AlertEvents but stay out of email.
 */
const MATERIAL_RULES = new Set<AlertRule>([
  "NEWS_MATERIAL",
  "TLH_OPPORTUNITY",
  "REBALANCE_DUE",
  "THESIS_INVALIDATION_CANDIDATE",
]);

/** Run all enabled alerts for a single user. Persists fired events. Also
 *  runs the platform-driven coaching watchers (TLH, REBALANCE) regardless
 *  of whether the user has configured any alerts of their own. */
export async function evaluateUserAlerts(userId: string): Promise<EvaluateResult> {
  // Platform coaching pass first — always runs, regardless of user-configured alerts.
  const coachingFired = await runCoachingPass(userId);

  const enabled = await prisma.alert.findMany({
    where: { userId, enabled: true },
  });
  if (enabled.length === 0) {
    return { evaluated: 0, fired: coachingFired.length, events: coachingFired };
  }

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

  let fresh: FiredEvent[] = [];
  if (candidateEvents.length > 0) {
    // Per-rule cooldown dedup, plus NEWS_MATERIAL handles its own newsId dedup internally
    fresh = await dedupeAgainstRecent(candidateEvents, enabled);
    if (fresh.length > 0) {
      await prisma.alertEvent.createMany({
        data: fresh.map((e) => ({
          alertId: e.alertId,
          userId: e.userId,
          ticker: e.ticker,
          message: e.message,
          data: e.data as Prisma.InputJsonValue,
        })),
      });
    }
  }

  // Combine user + coaching events for one digest per cron run.
  const allEvents: FiredEvent[] = [...fresh, ...coachingFired];
  if (allEvents.length === 0) {
    return { evaluated: enabled.length, fired: 0, events: [] };
  }

  // Email digest. Three gates, all of which must pass:
  //   1. User has emails enabled at all (emailDigestEnabled).
  //   2. The alert that fired has the EMAIL channel enabled.
  //   3. When silentUnlessMaterial is on (the default), only material-rule
  //      events earn email — the rest stay in-app only. This is the noise
  //      reduction for buy-and-hold portfolios.
  try {
    const prefs = await getUserPreferences(userId);
    if (prefs.emailDigestEnabled) {
      // Re-query alerts including any system-coaching alerts that may have
      // been created during the coaching pass above.
      const allAlertIds = Array.from(new Set(allEvents.map((e) => e.alertId)));
      const alertsForDigest = await prisma.alert.findMany({
        where: { id: { in: allAlertIds } },
        select: { id: true, rule: true, channels: true },
      });
      const ruleByAlertId = new Map<string, AlertRule>();
      const emailAlertIds = new Set<string>();
      for (const a of alertsForDigest) {
        ruleByAlertId.set(a.id, a.rule);
        const channels = Array.isArray(a.channels) ? (a.channels as unknown as string[]) : [];
        if (channels.includes("EMAIL")) emailAlertIds.add(a.id);
      }
      const emailEvents = allEvents.filter((e) => {
        if (!emailAlertIds.has(e.alertId)) return false;
        if (prefs.silentUnlessMaterial) {
          const rule = ruleByAlertId.get(e.alertId);
          return rule ? MATERIAL_RULES.has(rule) : false;
        }
        return true;
      });
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

  return {
    evaluated: enabled.length,
    fired: fresh.length + coachingFired.length,
    events: [...fresh, ...coachingFired],
  };
}

/**
 * Run TLH and rebalance watchers. Persist their events through a synthetic
 * "system" Alert per (user, rule) so they participate in the same event /
 * digest plumbing as user-configured alerts. Coaching alerts are material
 * by design — they pass the silentUnlessMaterial filter and route to email
 * when the user has the EMAIL channel on the system alert.
 */
async function runCoachingPass(userId: string): Promise<FiredEvent[]> {
  const [tlhEvents, rebalanceEvents] = await Promise.all([
    runTlhWatch(userId).catch((err) => {
      console.error(`[coaching/tlh] ${userId}:`, err);
      return [];
    }),
    runRebalanceWatch(userId).catch((err) => {
      console.error(`[coaching/rebalance] ${userId}:`, err);
      return [];
    }),
  ]);

  const out: FiredEvent[] = [];
  if (tlhEvents.length > 0) {
    const alert = await ensureSystemAlert(userId, "TLH_OPPORTUNITY");
    const data = tlhEvents.map((e) => ({
      alertId: alert.id,
      userId,
      ticker: e.ticker,
      message: e.message,
      data: e.data as Prisma.InputJsonValue,
    }));
    await prisma.alertEvent.createMany({ data });
    for (const e of tlhEvents) {
      out.push({ alertId: alert.id, userId, ticker: e.ticker, message: e.message, data: e.data });
    }
  }
  if (rebalanceEvents.length > 0) {
    const alert = await ensureSystemAlert(userId, "REBALANCE_DUE");
    const data = rebalanceEvents.map((e) => ({
      alertId: alert.id,
      userId,
      ticker: e.ticker,
      message: e.message,
      data: e.data as Prisma.InputJsonValue,
    }));
    await prisma.alertEvent.createMany({ data });
    for (const e of rebalanceEvents) {
      out.push({ alertId: alert.id, userId, ticker: e.ticker, message: e.message, data: e.data });
    }
  }

  // Email is deferred to the main user-alerts path so coaching + user events
  // bundle into a single digest per cron run.
  return out;
}

/**
 * Find-or-create the per-user system alert that anchors AlertEvents for a
 * given coaching rule. Users see these in /alerts (so they can disable the
 * email channel) but can't configure params — the platform owns the logic.
 */
async function ensureSystemAlert(userId: string, rule: AlertRule) {
  const existing = await prisma.alert.findFirst({
    where: { userId, rule, scope: "PORTFOLIO", ticker: null },
  });
  if (existing) return existing;
  return prisma.alert.create({
    data: {
      userId,
      rule,
      scope: "PORTFOLIO",
      ticker: null,
      params: {},
      enabled: true,
      channels: ["IN_APP", "EMAIL"],
    },
  });
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
