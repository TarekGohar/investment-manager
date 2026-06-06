import Link from "next/link";
import type { AlertEvent, AlertRule } from "@/generated/prisma";
import { RULE_LABEL } from "@/lib/signals/types";

type EventWithAlert = AlertEvent & { alert: { rule: AlertRule } };

/**
 * Compact row for notification-only AlertEvents (no recommendedAction).
 * Visually distinct from DecisionCard so the user can tell at a glance which
 * items require attention vs which are just FYI.
 */
export function NotificationCard({ event }: { event: EventWithAlert }) {
  return (
    <Link
      href={`/decisions/${event.id}`}
      className={`group block rounded-card border px-4 py-2.5 transition-colors hover:border-border-2 ${
        event.read ? "border-border bg-panel/50" : "border-border bg-panel"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        {event.ticker ? (
          <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 font-mono font-semibold tabular-nums">
            {event.ticker}
          </span>
        ) : (
          <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 font-semibold text-muted">
            Portfolio
          </span>
        )}
        <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 text-muted">
          {RULE_LABEL[event.alert.rule] ?? event.alert.rule}
        </span>
        {!event.read && (
          <span className="rounded-[6px] bg-brand-2/15 px-2 py-0.5 font-semibold text-brand-2">
            New
          </span>
        )}
        <span className="ml-auto text-muted-2">{relativeTime(event.firedAt)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{event.message}</p>
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
