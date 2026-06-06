import "server-only";
import { prisma } from "@/lib/prisma";
import type { AlertRule } from "@/generated/prisma";

const COACHING_RULES: AlertRule[] = [
  "TLH_OPPORTUNITY",
  "REBALANCE_DUE",
  "THESIS_INVALIDATION_CANDIDATE",
];

export type OpenRecommendation = {
  kind: "ALERT" | "PLAN";
  /** Either an AlertEvent id (kind=ALERT) or a PlannedAction id (kind=PLAN). */
  id: string;
  rule?: AlertRule;
  ticker: string | null;
  message: string;
  /** When the alert fired or the plan was created. */
  occurredAt: Date;
  /** Plan expiry date for TLH window (kind=PLAN, optional). */
  expiresAt?: Date | null;
  daysUntilExpiry?: number;
};

/**
 * Surfaces what the user should look at right now:
 *  1. Open PlannedActions (the user said they'd act, hasn't yet)
 *  2. Unread coaching AlertEvents (the platform flagged something, user
 *     hasn't responded with "plan it" or "dismiss")
 *
 * Capped at a reasonable display count (12) — if there's more, the user
 * should be on /decisions triaging anyway.
 */
export async function listOpenRecommendations(userId: string): Promise<OpenRecommendation[]> {
  const [plans, events] = await Promise.all([
    prisma.plannedAction.findMany({
      where: {
        userId,
        fulfilledAt: null,
        dismissedAt: null,
      },
      orderBy: { plannedAt: "desc" },
      take: 12,
    }),
    prisma.alertEvent.findMany({
      where: {
        userId,
        read: false,
        alert: { rule: { in: COACHING_RULES } },
      },
      orderBy: { firedAt: "desc" },
      include: { alert: { select: { rule: true } } },
      take: 12,
    }),
  ]);

  // De-dupe: if a plan exists for an alert, hide the alert (the plan supersedes).
  const planAlertEventIds = new Set(
    plans.map((p) => p.sourceAlertEventId).filter((id): id is string => !!id),
  );

  const items: OpenRecommendation[] = [];
  const now = Date.now();
  for (const p of plans) {
    const expiresAt = p.expiresAt;
    const daysUntilExpiry = expiresAt
      ? Math.max(0, Math.ceil((expiresAt.getTime() - now) / 86_400_000))
      : undefined;
    const payload = p.payload as Record<string, unknown> | null;
    const replacement =
      payload && typeof payload.replacementTicker === "string"
        ? String(payload.replacementTicker)
        : null;
    const message = formatPlanMessage(p.kind, p.ticker, replacement, payload);
    items.push({
      kind: "PLAN",
      id: p.id,
      ticker: p.ticker,
      message,
      occurredAt: p.plannedAt,
      expiresAt,
      daysUntilExpiry,
    });
  }
  for (const e of events) {
    if (planAlertEventIds.has(e.id)) continue;
    items.push({
      kind: "ALERT",
      id: e.id,
      rule: e.alert.rule,
      ticker: e.ticker,
      message: e.message,
      occurredAt: e.firedAt,
    });
  }
  return items.slice(0, 12);
}

function formatPlanMessage(
  kind: string,
  ticker: string | null,
  replacement: string | null,
  payload: Record<string, unknown> | null,
): string {
  switch (kind) {
    case "TLH_HARVEST":
      return `Plan: harvest loss on ${ticker ?? "?"}${replacement ? ` → ${replacement}` : ""}. Record the SELL when done.`;
    case "REBALANCE": {
      const cat = payload && typeof payload.category === "string" ? payload.category : null;
      return `Plan: rebalance${cat ? ` (${cat})` : ""}. Record the trades when done.`;
    }
    case "THESIS_REEVALUATION":
      return `Plan: reconsider thesis on ${ticker ?? "?"}.`;
    default:
      return `Plan in progress`;
  }
}
