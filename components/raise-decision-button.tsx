"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { raiseManualDecisionAction } from "@/app/actions/decisions";
import { useToast } from "@/components/toast-provider";
import type { DecisionUrgency, RecommendedAction } from "@/generated/prisma";

const ACTIONS: { value: RecommendedAction; label: string }[] = [
  { value: "ADD", label: "Add" },
  { value: "TRIM", label: "Trim" },
  { value: "EXIT", label: "Exit" },
  { value: "HOLD_THROUGH_DRAWDOWN", label: "Hold through drawdown" },
  { value: "DEPLOY_ELSEWHERE", label: "Deploy elsewhere" },
  { value: "HARVEST_LOSS", label: "Harvest loss" },
  { value: "REBALANCE", label: "Rebalance" },
];

const URGENCIES: { value: DecisionUrgency; label: string }[] = [
  { value: "INFO", label: "Info" },
  { value: "MATERIAL", label: "Material" },
  { value: "URGENT", label: "Urgent" },
];

export function RaiseDecisionButton({ ticker }: { ticker: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [action, setAction] = useState<RecommendedAction>("ADD");
  const [urgency, setUrgency] = useState<DecisionUrgency>("MATERIAL");
  const [message, setMessage] = useState("");
  const [rationale, setRationale] = useState("");
  const [reviewByDate, setReviewByDate] = useState("");

  function reset() {
    setAction("ADD");
    setUrgency("MATERIAL");
    setMessage("");
    setRationale("");
    setReviewByDate("");
  }

  function submit() {
    startTransition(async () => {
      const result = await raiseManualDecisionAction({
        ticker,
        recommendedAction: action,
        urgency,
        message,
        rationale,
        reviewByDate: reviewByDate || null,
      });
      if (result.ok) {
        toast({
          title: "Decision raised",
          description: "Open the Decisions inbox to track and close it.",
          variant: "success",
        });
        reset();
        setOpen(false);
        router.refresh();
      } else {
        toast({ title: "Couldn't raise", description: result.error, variant: "error" });
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-card border border-border bg-panel px-3 py-2 text-left text-sm font-semibold text-text transition-colors hover:border-border-2"
      >
        + Raise a decision{ticker ? ` on ${ticker}` : ""}
      </button>
    );
  }

  return (
    <section className="rounded-card border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Raise a decision{ticker ? ` on ${ticker}` : ""}
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-text"
        >
          Cancel
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Action">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as RecommendedAction)}
              className="w-full rounded-[8px] border border-border bg-panel px-2 py-1.5 text-sm"
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Urgency">
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as DecisionUrgency)}
              className="w-full rounded-[8px] border border-border bg-panel px-2 py-1.5 text-sm"
            >
              {URGENCIES.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Summary (one line for the inbox card)">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Trim AVGO 2 sh — over the per-name cap."
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm"
          />
        </Field>

        <Field label="Rationale (why now — and include 'I'd reverse this if X' + 'revisit at Y' as clauses if relevant)">
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={4}
            placeholder="Future-you will read this when the decision comes back up. One paragraph. Include the why, the falsifier, and the review trigger as natural-language clauses — no separate fields."
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-2 text-sm"
          />
        </Field>

        <Field label="Review by (optional date for the countdown)">
          <input
            type="date"
            value={reviewByDate}
            onChange={(e) => setReviewByDate(e.target.value)}
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm"
          />
        </Field>

        <button
          type="button"
          onClick={submit}
          disabled={pending || !message.trim() || rationale.trim().length < 10}
          className="w-full rounded-[8px] bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Raising…" : "Raise decision"}
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
