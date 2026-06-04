import "server-only";
import { prisma } from "@/lib/prisma";
import type {
  AlertRule,
  AlertSource,
  AlertScope,
  RecommendedAction,
  DecisionOutcome,
  DecisionUrgency,
  Prisma,
} from "@/generated/prisma";

/**
 * Single write path for the Decision Hub. Every medium that produces a
 * decision-worthy event — cron rules, AI chat, daily/weekly/annual reviews,
 * manual flags — goes through this function so the schema, FK contracts, and
 * downstream consumers (Hub inbox, retrospective, email digest) stay
 * consistent.
 *
 * For legacy CRON_RULE events we preserve the existing behavior: pass
 * `alertId` directly or pass `rule` and we'll ensure a system Alert row.
 *
 * For new sources (AI_CHAT, *_REVIEW, MANUAL), a synthetic Alert anchor is
 * ensured per user and rule. The non-cron rules (`AI_PROPOSED_DECISION`,
 * `REVIEW_PROPOSED_DECISION`, `MANUAL_FLAG`) are not scheduled — they just
 * exist to keep the AlertEvent → Alert FK valid.
 */

type Json = Record<string, unknown>;

export type CreateDecisionEventInput = {
  userId: string;
  source: AlertSource;
  ticker: string | null;
  message: string;
  // Legacy notification payload (snapshot of values at firing).
  data?: Json;

  // Either provide an existing alertId (for cron-rule reuse) OR a rule for
  // ensureSystemAlert to look up / create.
  alertId?: string;
  rule?: AlertRule;

  // Decision-grade fields. All optional — a row with no recommendedAction is
  // treated as a pure notification by the Hub inbox.
  recommendedAction?: RecommendedAction | null;
  actionDetails?: Json | null;
  rationale?: string | null;
  sizingRationale?: string | null;
  sizingDetails?: Json | null;
  supportingEvidence?: Json | null;
  alternativesConsidered?: string | null;
  invalidationTrigger?: string | null;
  reviewByDate?: Date | null;
  reviewEvent?: string | null;
  urgency?: DecisionUrgency;

  // Source-specific FKs.
  conversationId?: string | null;
  reviewId?: string | null;
};

export type DecisionEventRow = Awaited<ReturnType<typeof createDecisionEvent>>;

export async function createDecisionEvent(input: CreateDecisionEventInput) {
  validateSourceInvariants(input);

  const alertId = await resolveAlertId(input);

  return prisma.alertEvent.create({
    data: {
      alertId,
      userId: input.userId,
      ticker: input.ticker,
      message: input.message,
      data: (input.data ?? {}) as Prisma.InputJsonValue,

      source: input.source,
      recommendedAction: input.recommendedAction ?? null,
      actionDetails: jsonOrNull(input.actionDetails),
      rationale: input.rationale ?? null,
      sizingRationale: input.sizingRationale ?? null,
      sizingDetails: jsonOrNull(input.sizingDetails),
      supportingEvidence: jsonOrNull(input.supportingEvidence),
      alternativesConsidered: input.alternativesConsidered ?? null,
      invalidationTrigger: input.invalidationTrigger ?? null,
      reviewByDate: input.reviewByDate ?? null,
      reviewEvent: input.reviewEvent ?? null,
      urgency: input.urgency ?? "INFO",
      conversationId: input.conversationId ?? null,
      reviewId: input.reviewId ?? null,
    },
  });
}

export type RecordOutcomeInput = {
  eventId: string;
  userId: string;
  outcome: Exclude<DecisionOutcome, "OPEN">;
  executedQuantity?: number | null;
  executedPrice?: number | null;
  notes?: string | null;
};

export async function recordOutcome(input: RecordOutcomeInput) {
  // Scoped by userId so a stray eventId from another user can't be closed.
  const result = await prisma.alertEvent.updateMany({
    where: { id: input.eventId, userId: input.userId },
    data: {
      outcome: input.outcome,
      outcomeExecutedQuantity: input.executedQuantity ?? null,
      outcomeExecutedPrice: input.executedPrice ?? null,
      outcomeNotes: input.notes ?? null,
      outcomeRecordedAt: new Date(),
    },
  });
  if (result.count === 0) {
    throw new Error(`Decision event ${input.eventId} not found for user ${input.userId}.`);
  }
}

/**
 * Hub inbox query. Returns only decision-grade events (recommendedAction
 * present) so legacy notification-only AlertEvents don't clutter the queue.
 * Ordered by firedAt desc; urgency ranking happens in the UI for portability.
 */
export async function listOpenDecisions(args: {
  userId: string;
  urgency?: DecisionUrgency;
  limit?: number;
}) {
  return prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      outcome: "OPEN",
      recommendedAction: { not: null },
      ...(args.urgency ? { urgency: args.urgency } : {}),
    },
    orderBy: [{ firedAt: "desc" }],
    take: args.limit ?? 100,
    include: {
      alert: { select: { rule: true } },
    },
  });
}

/**
 * Notification-only events: AlertEvents that DO NOT carry a recommendedAction
 * (price moves, generic news flags, etc.). These show up in the unified
 * /alerts inbox alongside decision-grade events but don't have an action
 * button — the user just reads them and marks them as read.
 */
export async function listRecentNotifications(args: {
  userId: string;
  limit?: number;
  unreadOnly?: boolean;
}) {
  return prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      recommendedAction: null,
      ...(args.unreadOnly ? { read: false } : {}),
    },
    orderBy: [{ firedAt: "desc" }],
    take: args.limit ?? 25,
    include: { alert: { select: { rule: true } } },
  });
}

export async function markAlertEventRead(args: {
  userId: string;
  eventId: string;
}) {
  await prisma.alertEvent.updateMany({
    where: { id: args.eventId, userId: args.userId },
    data: { read: true },
  });
}

/**
 * History query: closed decisions for retrospective listing.
 */
export async function listClosedDecisions(args: {
  userId: string;
  limit?: number;
  ticker?: string;
}) {
  return prisma.alertEvent.findMany({
    where: {
      userId: args.userId,
      outcome: { not: "OPEN" },
      recommendedAction: { not: null },
      ...(args.ticker ? { ticker: args.ticker } : {}),
    },
    orderBy: [{ outcomeRecordedAt: "desc" }, { firedAt: "desc" }],
    take: args.limit ?? 100,
    include: {
      alert: { select: { rule: true } },
    },
  });
}

/**
 * Single decision detail. Includes the parent Alert (for rule attribution)
 * and a linked AIConversation summary when source=AI_CHAT.
 */
export async function getDecisionCard(args: { userId: string; eventId: string }) {
  return prisma.alertEvent.findFirst({
    where: { id: args.eventId, userId: args.userId },
    include: {
      alert: { select: { rule: true, scope: true } },
      conversation: {
        select: { id: true, scope: true, title: true, createdAt: true },
      },
    },
  });
}

// ─── internals ────────────────────────────────────────────────────────────

function validateSourceInvariants(input: CreateDecisionEventInput): void {
  switch (input.source) {
    case "AI_CHAT":
      if (!input.conversationId) {
        throw new Error("source=AI_CHAT requires conversationId.");
      }
      break;
    case "DAILY_REVIEW":
    case "WEEKLY_REVIEW":
    case "ANNUAL_REVIEW":
      if (!input.reviewId) {
        throw new Error(`source=${input.source} requires reviewId.`);
      }
      break;
    case "MANUAL":
      if (!input.rationale || input.rationale.trim().length === 0) {
        throw new Error("source=MANUAL requires a rationale.");
      }
      break;
    case "CRON_RULE":
      if (!input.alertId && !input.rule) {
        throw new Error("source=CRON_RULE requires either alertId or rule.");
      }
      break;
  }
}

async function resolveAlertId(input: CreateDecisionEventInput): Promise<string> {
  if (input.alertId) return input.alertId;
  const rule = input.rule ?? defaultRuleForSource(input.source);
  const alert = await ensureSystemAlert(input.userId, rule);
  return alert.id;
}

function defaultRuleForSource(source: AlertSource): AlertRule {
  switch (source) {
    case "AI_CHAT":
      return "AI_PROPOSED_DECISION";
    case "DAILY_REVIEW":
    case "WEEKLY_REVIEW":
    case "ANNUAL_REVIEW":
      return "REVIEW_PROPOSED_DECISION";
    case "MANUAL":
      return "MANUAL_FLAG";
    case "CRON_RULE":
      throw new Error("CRON_RULE source requires explicit alertId or rule.");
  }
}

async function ensureSystemAlert(userId: string, rule: AlertRule) {
  const scope: AlertScope = "PORTFOLIO";
  const existing = await prisma.alert.findFirst({
    where: { userId, rule, scope, ticker: null },
  });
  if (existing) return existing;
  return prisma.alert.create({
    data: {
      userId,
      rule,
      scope,
      ticker: null,
      params: {},
      enabled: true,
      channels: ["IN_APP"],
    },
  });
}

function jsonOrNull(v: Json | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  // Prisma's Json nullable column needs the sentinel for explicit nulls.
  if (v == null) return null as unknown as typeof Prisma.JsonNull;
  return v as Prisma.InputJsonValue;
}
