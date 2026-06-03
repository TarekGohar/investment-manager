import type { AiUsageEvent } from "@/lib/ai/queries";

const KIND_TONE: Record<AiUsageEvent["kind"], { bg: string; label: string }> = {
  chat: { bg: "bg-brand/15 text-brand-2", label: "Chat" },
  "review-daily": { bg: "bg-success/15 text-success", label: "Daily" },
  "review-weekly": { bg: "bg-success/15 text-success", label: "Weekly" },
  "review-annual": { bg: "bg-success/15 text-success", label: "Annual" },
  "filing-deep": { bg: "bg-warning/15 text-warning", label: "Filing" },
  other: { bg: "bg-pill text-muted", label: "Other" },
};

/**
 * Per-row feed of AI calls that actually drew down the Anthropic / OpenAI
 * meter. Reads from listRecentAiEvents — already filtered to rows with
 * nonzero tokens. Most days nothing happens; this view makes those days
 * legible instead of misleadingly empty by showing the running tally.
 */
export function UsageFeed({ events }: { events: AiUsageEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-panel/40 p-10 text-center">
        <p className="text-sm font-medium text-text">No AI calls yet</p>
        <p className="mt-1 text-xs text-muted">
          Costs land here the moment a chat turn, a review, or a filing summary fires.
        </p>
      </div>
    );
  }

  const totalCost = events.reduce((sum, e) => sum + e.costUsd, 0);
  const totalTokens = events.reduce((sum, e) => sum + e.totalTokens, 0);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="text-[14px] font-semibold text-text">
          Last {events.length} call{events.length === 1 ? "" : "s"}
        </h4>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-text">
            {formatUsd(totalCost)}
          </div>
          <div className="text-[11px] text-muted-2 tabular-nums">
            {compactTokens(totalTokens)} tokens
          </div>
        </div>
      </div>

      <ul className="divide-y divide-border rounded-card border border-border bg-bg/40">
        {events.map((ev) => {
          const tone = KIND_TONE[ev.kind];
          return (
            <li
              key={ev.id}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-3 px-3 py-2.5 sm:px-4"
            >
              <span
                className={`mt-0.5 inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide ${tone.bg}`}
              >
                {tone.label}
              </span>

              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text">
                  {ev.label}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-2 tabular-nums">
                  <span>{formatWhen(ev.at)}</span>
                  {ev.model ? <span title={ev.model}>{shortModel(ev.model)}</span> : null}
                  <span>
                    in {compactTokens(ev.inputTokens + ev.cachedTokens + ev.cacheCreationTokens)}
                    {ev.cachedTokens > 0
                      ? ` (${Math.round((ev.cachedTokens / Math.max(1, ev.inputTokens + ev.cachedTokens + ev.cacheCreationTokens)) * 100)}% cached)`
                      : ""}
                    {" · "}out {compactTokens(ev.outputTokens)}
                  </span>
                </div>
              </div>

              <div className="text-right text-[13px] font-semibold tabular-nums text-text">
                {formatUsd(ev.costUsd)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.005) return "<$0.01";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

function compactTokens(value: number): string {
  if (value < 1_000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)}M`;
}

function shortModel(model: string): string {
  // Strip the date suffix Anthropic appends, keep family + tier.
  return model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
}

function formatWhen(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
