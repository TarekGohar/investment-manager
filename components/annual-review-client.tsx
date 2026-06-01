"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateAnnualReviewAction } from "@/app/actions/annual-review";
import { useToast } from "@/components/toast-provider";
import { Markdown } from "@/components/markdown";

export function AnnualReviewClient({
  defaultYear,
  initialReview,
}: {
  defaultYear: number;
  initialReview: {
    id: string;
    title: string | null;
    body: string;
    generatedAt: Date;
  } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [year, setYear] = useState(String(defaultYear));
  const [pending, startTransition] = useTransition();
  const [review] = useState(initialReview);

  function onGenerate() {
    const y = Number(year);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      toast({ title: "Pick a valid year", variant: "error" });
      return;
    }
    startTransition(async () => {
      const result = await generateAnnualReviewAction({ year: y });
      if (!result.ok) {
        toast({ title: "Couldn't generate", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Annual review generated", variant: "success" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-card border border-border bg-panel p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted">Tax year</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="mt-1 w-32 rounded-[10px] border border-border bg-bg px-3 py-2 text-[15px] tabular-nums outline-none focus:border-brand"
            />
          </label>
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            className="rounded-[20px] bg-gradient-to-r from-brand to-brand-3 px-5 py-2.5 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Generating…" : `Generate ${year} review`}
          </button>
        </div>
      </section>

      {review ? (
        <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-semibold">
              {review.title ?? "Annual review"}
            </h2>
            <span className="text-xs text-muted">
              Generated{" "}
              {new Date(review.generatedAt).toLocaleString("en-CA", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="prose-pm">
            <Markdown>{review.body}</Markdown>
          </div>
        </section>
      ) : (
        <section className="rounded-card border border-dashed border-border bg-panel/40 px-6 py-12 text-center text-sm text-muted">
          No annual review generated yet. Pick a year above and click
          Generate. The first one for a given year costs an LLM call (~$0.02
          on gpt-4o-mini); subsequent runs overwrite.
        </section>
      )}
    </div>
  );
}
