"use client";

import { useState, useTransition } from "react";
import { recordConvictionRatingAction } from "@/app/actions/policy";
import { useToast } from "@/components/toast-provider";
import type { ConvictionHistoryRecord } from "@/lib/policy/thesis";

type Props = {
  ticker: string;
  currentRating: number | null;
  ratedAt: Date | null;
  currentNotes: string | null;
  initialTrajectory?: ConvictionHistoryRecord[];
};

const RATING_DESCRIPTIONS: Record<number, string> = {
  1: "I'd exit today if starting fresh",
  2: "Wouldn't initiate; tolerating",
  3: "Weak hold; below the bar",
  4: "Below average for the book",
  5: "Marginal — needs a re-look",
  6: "Solid — staying put",
  7: "Strong; above average",
  8: "High conviction",
  9: "Top tier",
  10: "Highest conviction in the book",
};

export function ConvictionReRate(props: Props) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number>(props.currentRating ?? 6);
  const [notes, setNotes] = useState("");
  const [trajectory, setTrajectory] = useState<ConvictionHistoryRecord[]>(
    props.initialTrajectory ?? [],
  );
  const [current, setCurrent] = useState<{
    rating: number | null;
    ratedAt: Date | null;
    notes: string | null;
  }>({
    rating: props.currentRating,
    ratedAt: props.ratedAt,
    notes: props.currentNotes,
  });

  const isStale =
    current.ratedAt == null ||
    Date.now() - current.ratedAt.getTime() > 90 * 86_400_000;

  const priorRating = current.rating;
  const bigSwing = priorRating != null && Math.abs(rating - priorRating) >= 2;

  function submit() {
    if (bigSwing && notes.trim().length === 0) {
      toast({
        title: "Notes required",
        description: `Moving from ${priorRating} to ${rating} is a 2-point swing — explain why.`,
        variant: "error",
      });
      return;
    }
    startTransition(async () => {
      const result = await recordConvictionRatingAction({
        ticker: props.ticker,
        rating,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        toast({ title: `Conviction recorded: ${rating}/10`, variant: "success" });
        setOpen(false);
        setNotes("");
        setTrajectory(result.trajectory);
        setCurrent({
          rating,
          ratedAt: new Date(),
          notes: notes.trim() || null,
        });
      } else {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <div className="mt-4 rounded-[10px] border border-border bg-bg/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Conviction
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-semibold text-brand-2 hover:underline"
        >
          {open ? "Cancel" : current.rating == null ? "Rate now" : "Re-rate"}
        </button>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <div className="text-2xl font-semibold tabular-nums">
          {current.rating ?? "—"}
          {current.rating != null && <span className="text-base text-muted">/10</span>}
        </div>
        <div className="text-xs text-muted">
          {current.ratedAt
            ? `Last rated ${current.ratedAt.toISOString().slice(0, 10)} (${daysAgoLabel(current.ratedAt)})`
            : "Never rated"}
        </div>
        {isStale && (
          <span className="rounded-[6px] bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
            Stale
          </span>
        )}
      </div>

      {current.notes && !open && (
        <p className="mt-1 text-xs italic text-muted">{current.notes}</p>
      )}

      {trajectory.length > 1 && (
        <Trajectory trajectory={trajectory} />
      )}

      {open && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted">
              New rating
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="mt-2 w-full"
            />
            <div className="mt-1 flex items-baseline justify-between text-xs">
              <span className="tabular-nums font-semibold">{rating}/10</span>
              <span className="text-muted">{RATING_DESCRIPTIONS[rating]}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted">
              Notes{" "}
              {bigSwing && (
                <span className="text-warning">
                  (required — {priorRating} → {rating} is a 2-point swing)
                </span>
              )}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What changed? Why this rating today vs last quarter?"
              className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="w-full rounded-[8px] bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Record rating"}
          </button>
        </div>
      )}
    </div>
  );
}

function Trajectory({ trajectory }: { trajectory: ConvictionHistoryRecord[] }) {
  // Oldest first for visual chronology
  const ordered = [...trajectory].reverse();
  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Trajectory
      </div>
      <div className="mt-2 flex items-end gap-1">
        {ordered.map((r, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className="w-5 rounded-t-sm bg-brand-2/60"
              style={{ height: `${r.rating * 4}px` }}
              title={`${r.rating}/10 on ${r.ratedAt.toISOString().slice(0, 10)}`}
            />
            <div className="text-[10px] tabular-nums text-muted">{r.rating}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function daysAgoLabel(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}
