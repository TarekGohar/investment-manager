import Link from "next/link";
import { TickerBadge } from "@/components/ticker-badge";
import { RULE_LABEL } from "@/lib/signals/types";
import type { AlertEventItem } from "@/lib/signals/queries";

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function AlertEventsFeed({ events }: { events: AlertEventItem[] }) {
  return (
    <div className="rounded-card border border-border bg-panel">
      <div className="flex items-center justify-between px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Recent events</h2>
        <span className="text-xs text-muted">
          {events.length === 0 ? "Nothing here yet" : `${events.length} event${events.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="border-t border-border px-6 py-10 text-center text-sm text-muted">
          When an alert rule fires, the trigger lands here.
        </div>
      ) : (
        events.map((ev) => {
          const inner = (
            <>
              {ev.ticker ? (
                <TickerBadge ticker={ev.ticker} size={36} />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pill text-[11px] font-bold text-muted">
                  P
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  {!ev.read ? (
                    <span
                      className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-brand"
                      aria-label="Unread"
                    />
                  ) : null}
                  <div className="text-[14px] font-semibold leading-snug text-text">
                    {ev.message}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {RULE_LABEL[ev.alertRule]} · {timeAgo(ev.firedAt)}
                </div>
              </div>
            </>
          );
          const baseCls = `flex items-center gap-3 border-t border-border px-4 py-4 md:px-6 ${
            ev.read ? "" : "bg-brand/[0.03]"
          }`;
          return ev.ticker ? (
            <Link
              key={ev.id}
              href={`/positions/${ev.ticker}`}
              className={`${baseCls} transition-colors hover:bg-hover`}
            >
              {inner}
            </Link>
          ) : (
            <div key={ev.id} className={baseCls}>
              {inner}
            </div>
          );
        })
      )}
    </div>
  );
}
