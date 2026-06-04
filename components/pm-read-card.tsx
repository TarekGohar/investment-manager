"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateWeeklyReviewAction } from "@/app/actions/reviews";
import { useToast } from "@/components/toast-provider";
import { Markdown } from "@/components/markdown";

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

export function PMReadCard({
  initialReview,
  hasHoldings,
}: {
  initialReview: { title: string | null; body: string; generatedAt: Date } | null;
  hasHoldings: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const review = initialReview;
  const [pending, startTransition] = useTransition();

  function regenerate() {
    if (pending) return;
    startTransition(async () => {
      const result = await generateWeeklyReviewAction();
      if (!result.ok) {
        toast({ title: "Couldn't generate review", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Review generated", variant: "success" });
      router.refresh();
    });
  }

  if (!hasHoldings) {
    return (
      <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[16px] font-semibold">PM&apos;s read</h3>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Record your first transaction and you&apos;ll be able to generate a portfolio review
          here on demand.
        </p>
      </section>
    );
  }

  if (!review) {
    return (
      <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[16px] font-semibold">PM&apos;s read</h3>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          No review generated yet. Reviews are on-demand — pull one when you want a snapshot
          of where the portfolio stands.
        </p>
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="rounded-[20px] bg-gradient-to-r from-brand to-brand-3 px-5 py-2.5 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate weekly review"}
        </button>
      </section>
    );
  }

  return (
    <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold">PM&apos;s read</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">{timeAgo(review.generatedAt)}</span>
          <button
            type="button"
            onClick={regenerate}
            disabled={pending}
            className="rounded-full bg-pill px-3 py-1 text-xs font-semibold text-text transition-colors hover:bg-pill/70 disabled:opacity-60"
          >
            {pending ? "Generating…" : "Refresh"}
          </button>
        </div>
      </div>
      <Markdown>{review.body}</Markdown>
    </section>
  );
}
