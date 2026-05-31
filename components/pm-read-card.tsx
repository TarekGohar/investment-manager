"use client";

import { useState, useTransition } from "react";
import { generateDailyReviewAction } from "@/app/actions/reviews";
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
  const toast = useToast();
  const [review, setReview] = useState(initialReview);
  const [pending, startTransition] = useTransition();

  function regenerate() {
    if (pending) return;
    startTransition(async () => {
      const result = await generateDailyReviewAction();
      if (!result.ok) {
        toast({ title: "Couldn't generate review", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Review generated", variant: "success" });
      // Wait a beat then refresh; revalidatePath in the action triggers a server refetch
      // on next nav. For instant feedback, we could re-fetch via a client action; for now
      // a soft refresh works.
      window.location.reload();
    });
  }

  if (!hasHoldings) {
    return (
      <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[16px] font-semibold">PM&apos;s read</h3>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Record your first buy and an AI portfolio review will start landing here after each
          market close.
        </p>
      </section>
    );
  }

  if (!review) {
    return (
      <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[16px] font-semibold">PM&apos;s read</h3>
          <button
            type="button"
            onClick={regenerate}
            disabled={pending}
            className="text-xs font-semibold text-brand-2 hover:underline disabled:opacity-60"
          >
            {pending ? "Generating…" : "Generate now"}
          </button>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          No portfolio review yet. The daily cron runs after market close (Mon–Fri); you can also
          trigger one manually with the link above.
        </p>
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
            className="text-xs font-semibold text-brand-2 hover:underline disabled:opacity-60"
          >
            {pending ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </div>
      <Markdown>{review.body}</Markdown>
    </section>
  );
}
