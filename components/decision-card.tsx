import Link from "next/link";
import type {
  AlertEvent,
  AlertRule,
  AlertSource,
  RecommendedAction,
  DecisionOutcome,
  DecisionUrgency,
} from "@/generated/prisma";

type EventWithAlert = AlertEvent & { alert: { rule: AlertRule } };

const ACTION_LABEL: Record<RecommendedAction, string> = {
  ADD: "Add",
  TRIM: "Trim",
  EXIT: "Exit",
  HOLD_THROUGH_DRAWDOWN: "Hold through drawdown",
  DEPLOY_ELSEWHERE: "Deploy elsewhere",
  HARVEST_LOSS: "Harvest loss",
  REBALANCE: "Rebalance",
  REVIEW_THESIS: "Review thesis",
  NONE: "—",
};

// Color tone for the action verb — picks up at-a-glance signal across the
// inbox list. Sell-type actions warn (warning/danger), buy-type are positive
// (success/brand-2), hold/review are neutral.
const ACTION_TONE: Record<RecommendedAction, string> = {
  ADD: "text-success",
  TRIM: "text-warning",
  EXIT: "text-danger",
  HOLD_THROUGH_DRAWDOWN: "text-muted",
  DEPLOY_ELSEWHERE: "text-brand-2",
  HARVEST_LOSS: "text-brand",
  REBALANCE: "text-brand-2",
  REVIEW_THESIS: "text-muted",
  NONE: "text-muted",
};

// Card-level tint paired with the action — subtle bg + a matching border in
// the same color family. Keeps the inbox scannable by color. URGENT cards
// override with a stronger danger tint regardless of action.
const ACTION_CARD_TINT: Record<RecommendedAction, string> = {
  ADD: "border-success/30 bg-success/5",
  TRIM: "border-warning/30 bg-warning/5",
  EXIT: "border-danger/30 bg-danger/5",
  HOLD_THROUGH_DRAWDOWN: "border-border bg-panel",
  DEPLOY_ELSEWHERE: "border-brand-2/30 bg-brand-2/5",
  HARVEST_LOSS: "border-brand/30 bg-brand/5",
  REBALANCE: "border-brand-2/30 bg-brand-2/5",
  REVIEW_THESIS: "border-border bg-panel",
  NONE: "border-border bg-panel",
};

const SOURCE_LABEL: Record<AlertSource, string> = {
  CRON_RULE: "rule",
  AI_CHAT: "chat",
  DAILY_REVIEW: "daily",
  WEEKLY_REVIEW: "weekly",
  ANNUAL_REVIEW: "annual",
  MANUAL: "manual",
};

const OUTCOME_LABEL: Record<DecisionOutcome, string> = {
  OPEN: "Open",
  EXECUTED_AS_RECOMMENDED: "Executed",
  EXECUTED_REVISED: "Executed (revised)",
  ABANDONED: "Abandoned",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

const OUTCOME_TONE: Record<DecisionOutcome, string> = {
  OPEN: "text-muted",
  EXECUTED_AS_RECOMMENDED: "text-success",
  EXECUTED_REVISED: "text-success",
  ABANDONED: "text-muted",
  REJECTED: "text-danger",
  EXPIRED: "text-muted",
};

export function DecisionCard({ event, closed }: { event: EventWithAlert; closed?: boolean }) {
  const action = event.recommendedAction;
  const degree = describeDegree(event.sizingDetails as Record<string, unknown> | null);
  const reviewDays = event.reviewByDate ? daysFromNow(event.reviewByDate) : null;
  const isUrgent = event.urgency === "URGENT";

  return (
    <Link
      href={`/decisions/${event.id}`}
      className={`group block rounded-card border px-4 py-3 transition-colors hover:border-border-2 ${
        isUrgent
          ? "border-danger/50 bg-danger/10"
          : action
            ? ACTION_CARD_TINT[action]
            : "border-border bg-panel"
      }`}
    >
      {/* Verdict + ticker + time. No urgency badge (grouped by urgency
          already), no source chip (folded into the meta line below), no
          outcome chip on open decisions. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {action && (
          <span className={`text-[15px] font-semibold ${ACTION_TONE[action]}`}>
            {ACTION_LABEL[action]}
          </span>
        )}
        {event.ticker ? (
          <span className="font-mono text-[15px] font-semibold tabular-nums">
            {event.ticker}
          </span>
        ) : (
          <span className="text-[15px] font-semibold text-muted">Portfolio</span>
        )}
        {closed && (
          <span className={`ml-1 text-xs ${OUTCOME_TONE[event.outcome]}`}>
            · {OUTCOME_LABEL[event.outcome]}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-2">{relativeTime(event.firedAt)}</span>
      </div>

      {/* Rationale snippet — 2 lines max. */}
      {event.rationale ? (
        <p className="mt-1.5 line-clamp-2 text-sm text-text">{stripMarkdown(event.rationale)}</p>
      ) : event.message ? (
        <p className="mt-1.5 line-clamp-2 text-sm text-muted">{stripMarkdown(event.message)}</p>
      ) : null}

      {/* Meta strip: DEGREE summary + review countdown + source. */}
      {(degree || reviewDays != null) && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
          {degree && <span className="tabular-nums">{degree}</span>}
          {reviewDays != null && (
            <span>
              review {reviewDays >= 0 ? `in ${reviewDays}d` : `${Math.abs(reviewDays)}d ago`}
            </span>
          )}
          <span className="ml-auto text-muted-2">via {SOURCE_LABEL[event.source]}</span>
        </div>
      )}
    </Link>
  );
}

// Returns a one-line DEGREE summary like "33.78% → 20%" or "Sell 13 sh" if
// the sizingDetails carry standardized keys. Empty when no structured numbers.
function describeDegree(sd: Record<string, unknown> | null): string | null {
  if (!sd) return null;
  const target = num(sd.targetWeightPct) ?? num(sd.targetMaxSingleNameWeightPct);
  const current = num(sd.currentWeightPct) ?? num(sd.currentPositionPctOfNav);
  const shares = num(sd.expectedSharesDelta);
  const dollars = num(sd.expectedDollarDelta) ?? num(sd.nominalUsd);

  if (current != null && target != null) {
    return `${current.toFixed(2)}% → ${target.toFixed(2)}% NAV`;
  }
  if (target != null) return `target ${target.toFixed(2)}% NAV`;
  if (current != null) return `at ${current.toFixed(2)}% NAV`;
  if (shares != null) {
    const verb = shares < 0 ? "Sell" : "Buy";
    return `${verb} ${Math.abs(shares).toFixed(0)} sh`;
  }
  if (dollars != null) {
    const verb = dollars < 0 ? "Free up" : "Deploy";
    return `${verb} $${Math.abs(dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

// Strip the most common markdown markers for a clamped inline preview.
// Doesn't render — just removes the `*` and `_` decoration so the preview
// reads cleanly without dragging in a full markdown parser.
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

function daysFromNow(d: Date): number {
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}
