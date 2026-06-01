import "server-only";
import { prisma } from "@/lib/prisma";
import { sendAlertDigest } from "@/lib/email";
import { getUserPreferences } from "@/lib/preferences";
import type { AlertRule, Prisma } from "@/generated/prisma";

/**
 * Persist coaching events through the platform's system-alert pipe. Used by
 * both the alert-evaluator cron (Session 4) and the pull-filings cron
 * (Session 5). Coaching rules are always material → email digest fires when
 * the user has `emailDigestEnabled`.
 */
export type CoachingPersistInput = {
  userId: string;
  ticker: string | null;
  message: string;
  data: Record<string, unknown>;
};

export async function persistCoachingEvents(
  rule: AlertRule,
  events: CoachingPersistInput[],
): Promise<void> {
  if (events.length === 0) return;

  // Group by userId — each user needs their own system alert ID.
  const byUser = new Map<string, CoachingPersistInput[]>();
  for (const e of events) {
    const arr = byUser.get(e.userId) ?? [];
    arr.push(e);
    byUser.set(e.userId, arr);
  }

  for (const [userId, userEvents] of byUser) {
    try {
      const alert = await ensureSystemAlert(userId, rule);
      await prisma.alertEvent.createMany({
        data: userEvents.map((e) => ({
          alertId: alert.id,
          userId,
          ticker: e.ticker,
          message: e.message,
          data: e.data as Prisma.InputJsonValue,
        })),
      });

      // Email digest — same gates as user-configured alerts.
      const prefs = await getUserPreferences(userId);
      if (!prefs.emailDigestEnabled) continue;
      const channels = Array.isArray(alert.channels)
        ? (alert.channels as unknown as string[])
        : [];
      if (!channels.includes("EMAIL")) continue;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user?.email) continue;

      await sendAlertDigest({
        email: user.email,
        events: userEvents.map((e) => ({
          ticker: e.ticker,
          message: e.message,
          firedAt: new Date(),
        })),
      });
    } catch (err) {
      console.error(`[coaching/persist] ${rule} for ${userId} failed:`, err);
    }
  }
}

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
