import "server-only";
import { prisma } from "@/lib/prisma";
import type { AlertConfig } from "./types";
import type { AlertRule, AlertScope, Alert, AlertEvent } from "@/generated/prisma";

export type AlertListItem = AlertConfig & {
  createdAt: Date;
  updatedAt: Date;
  lastFiredAt: Date | null;
  firedCount: number;
};

export type AlertEventItem = {
  id: string;
  alertId: string;
  alertRule: AlertRule;
  ticker: string | null;
  firedAt: Date;
  message: string;
  data: Record<string, unknown>;
  read: boolean;
};

/**
 * Coaching rules are platform-driven (TLH watcher, rebalance watcher,
 * thesis-invalidation watcher). They get system Alert rows so events have
 * something to attach to, but they're not user-configurable — exclude from
 * the /decisions management UI.
 */
const COACHING_RULES = new Set([
  "TLH_OPPORTUNITY",
  "REBALANCE_DUE",
  "THESIS_INVALIDATION_CANDIDATE",
]);

export async function listAlertsForUser(userId: string): Promise<AlertListItem[]> {
  const rows = await prisma.alert.findMany({
    where: {
      userId,
      rule: { notIn: Array.from(COACHING_RULES) as never[] },
    },
    orderBy: { createdAt: "asc" },
    include: {
      events: {
        orderBy: { firedAt: "desc" },
        take: 1,
        select: { firedAt: true },
      },
      _count: { select: { events: true } },
    },
  });

  return rows.map(rowToListItem);
}

function rowToListItem(
  a: Alert & {
    events: { firedAt: Date }[];
    _count: { events: number };
  },
): AlertListItem {
  const channels = Array.isArray(a.channels)
    ? (a.channels as string[]).filter((c) => c === "IN_APP" || c === "EMAIL")
    : ["IN_APP"];
  return {
    id: a.id,
    userId: a.userId,
    rule: a.rule as AlertRule,
    scope: a.scope as AlertScope,
    ticker: a.ticker,
    params: (a.params as Record<string, unknown>) ?? {},
    enabled: a.enabled,
    channels: channels as ("IN_APP" | "EMAIL")[],
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    lastFiredAt: a.events[0]?.firedAt ?? null,
    firedCount: a._count.events,
  };
}

export async function listRecentEvents(
  userId: string,
  daysBack = 30,
): Promise<AlertEventItem[]> {
  const since = new Date(Date.now() - daysBack * 86_400_000);
  const rows = await prisma.alertEvent.findMany({
    where: { userId, firedAt: { gte: since } },
    orderBy: { firedAt: "desc" },
    include: { alert: { select: { rule: true } } },
    take: 50,
  });
  return rows.map<AlertEventItem>((r) => ({
    id: r.id,
    alertId: r.alertId,
    alertRule: r.alert.rule as AlertRule,
    ticker: r.ticker,
    firedAt: r.firedAt,
    message: r.message,
    data: (r.data as Record<string, unknown>) ?? {},
    read: r.read,
  }));
}

export async function countUnreadEvents(userId: string): Promise<number> {
  return await prisma.alertEvent.count({ where: { userId, read: false } });
}

export async function markAllEventsRead(userId: string): Promise<void> {
  await prisma.alertEvent.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}
