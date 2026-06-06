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

const ACTION_TONE: Record<RecommendedAction, string> = {
  ADD: "text-success border-success/50",
  TRIM: "text-warning border-warning/50",
  EXIT: "text-danger border-danger/50",
  HOLD_THROUGH_DRAWDOWN: "text-muted border-border",
  DEPLOY_ELSEWHERE: "text-brand-2 border-brand-2/50",
  HARVEST_LOSS: "text-brand border-brand/50",
  REBALANCE: "text-brand-2 border-brand-2/50",
  REVIEW_THESIS: "text-muted border-border",
  NONE: "text-muted border-border",
};

const URGENCY_TONE: Record<DecisionUrgency, string> = {
  URGENT: "bg-danger/15 text-danger",
  MATERIAL: "bg-warning/15 text-warning",
  INFO: "bg-panel text-muted",
};

const SOURCE_LABEL: Record<AlertSource, string> = {
  CRON_RULE: "Cron",
  AI_CHAT: "Chat",
  DAILY_REVIEW: "Daily review",
  WEEKLY_REVIEW: "Weekly review",
  ANNUAL_REVIEW: "Annual review",
  MANUAL: "Manual",
};

const OUTCOME_LABEL: Record<DecisionOutcome, string> = {
  OPEN: "Open",
  EXECUTED_AS_RECOMMENDED: "Executed",
  EXECUTED_REVISED: "Executed (revised)",
  ABANDONED: "Abandoned",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export function DecisionCard({ event, closed }: { event: EventWithAlert; closed?: boolean }) {
  const action = event.recommendedAction;
  return (
    <Link
      href={`/decisions/${event.id}`}
      className="group block rounded-card border border-border bg-panel px-4 py-3 transition-colors hover:border-border-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {event.ticker ? (
          <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 font-mono font-semibold tabular-nums">
            {event.ticker}
          </span>
        ) : (
          <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 font-semibold text-muted">
            Portfolio
          </span>
        )}
        {action && (
          <span
            className={`rounded-[6px] border px-2 py-0.5 font-semibold ${ACTION_TONE[action]}`}
          >
            {ACTION_LABEL[action]}
          </span>
        )}
        <span className={`rounded-[6px] px-2 py-0.5 font-semibold ${URGENCY_TONE[event.urgency]}`}>
          {event.urgency}
        </span>
        <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 text-muted">
          {SOURCE_LABEL[event.source]}
        </span>
        {closed && (
          <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 text-muted">
            {OUTCOME_LABEL[event.outcome]}
          </span>
        )}
        <span className="ml-auto text-muted-2">{relativeTime(event.firedAt)}</span>
      </div>
      {event.rationale && (
        <p className="mt-2 line-clamp-2 text-sm text-text">{event.rationale}</p>
      )}
      {!event.rationale && event.message && (
        <p className="mt-2 line-clamp-2 text-sm text-muted">{event.message}</p>
      )}
      {event.reviewEvent && (
        <p className="mt-1.5 text-xs text-muted-2">
          Review trigger: <span className="text-muted">{event.reviewEvent}</span>
          {event.reviewByDate && (
            <> · by {event.reviewByDate.toISOString().slice(0, 10)}</>
          )}
        </p>
      )}
    </Link>
  );
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
