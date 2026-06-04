"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markIntentAction,
  dismissAlertAction,
  dismissPlannedActionAction,
} from "@/app/actions/planned-actions";
import { useToast } from "@/components/toast-provider";
import type { OpenRecommendation } from "@/lib/coaching/queries";

const RULE_PILL: Record<string, { label: string; tone: string }> = {
  TLH_OPPORTUNITY: { label: "TLH", tone: "bg-warning/15 text-warning" },
  REBALANCE_DUE: { label: "Rebalance", tone: "bg-brand/15 text-brand-2" },
  THESIS_INVALIDATION_CANDIDATE: {
    label: "Thesis",
    tone: "bg-danger/15 text-danger",
  },
  PLAN: { label: "Planned", tone: "bg-success/15 text-success" },
};

export function OpenRecommendationsCard({
  items,
}: {
  items: OpenRecommendation[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-[26px] rounded-card border border-border bg-panel">
      <div className="flex items-baseline justify-between px-6 py-4">
        <h3 className="text-[16px] font-semibold">Things to look at</h3>
        <span className="text-xs text-muted">
          {items.length} open · platform-suggested
        </span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <Item key={it.id} item={it} />
        ))}
      </ul>
    </section>
  );
}

function Item({ item }: { item: OpenRecommendation }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const pillKey = item.kind === "PLAN" ? "PLAN" : item.rule;
  const pill = pillKey ? RULE_PILL[pillKey] ?? { label: pillKey, tone: "bg-muted/15 text-muted" } : null;

  function onPlan() {
    if (item.kind !== "ALERT") return;
    startTransition(async () => {
      const result = await markIntentAction({ alertEventId: item.id });
      if (!result.ok) {
        toast({ title: "Couldn't save plan", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Plan tracked", description: "I'll remind you when the trade settles.", variant: "success" });
      router.refresh();
    });
  }

  function onDismiss() {
    startTransition(async () => {
      const result =
        item.kind === "PLAN"
          ? await dismissPlannedActionAction(item.id)
          : await dismissAlertAction(item.id);
      if (!result.ok) {
        toast({ title: "Couldn't dismiss", description: result.error, variant: "error" });
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 px-6 py-3.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
      <div className="min-w-0 sm:flex-1">
        <div className="mb-1 flex items-center gap-2">
          {pill ? (
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.tone}`}
            >
              {pill.label}
            </span>
          ) : null}
          {item.ticker ? (
            <Link
              href={`/positions/${item.ticker}`}
              className="font-mono text-[13px] font-semibold hover:underline"
            >
              {item.ticker}
            </Link>
          ) : null}
          {item.daysUntilExpiry != null ? (
            <span className="text-[11px] text-muted-2">
              {item.daysUntilExpiry === 0 ? "expires today" : `${item.daysUntilExpiry}d left`}
            </span>
          ) : null}
        </div>
        <p className="text-[13px] leading-relaxed text-text">{item.message}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {item.kind === "ALERT" ? (
          <button
            type="button"
            onClick={onPlan}
            disabled={pending}
            className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
          >
            Mark as planned
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          disabled={pending}
          className="rounded-full bg-pill px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-pill/70 disabled:opacity-60"
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}
