"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordDecisionOutcomeAction } from "@/app/actions/decisions";
import { useToast } from "@/components/toast-provider";
import type { DecisionOutcome } from "@/generated/prisma";

type OutcomeOption = Exclude<DecisionOutcome, "OPEN" | "EXPIRED">;

const OPTIONS: { value: OutcomeOption; label: string; help: string }[] = [
  {
    value: "EXECUTED_AS_RECOMMENDED",
    label: "Executed as recommended",
    help: "Followed the recommendation exactly (same quantity, similar price).",
  },
  {
    value: "EXECUTED_REVISED",
    label: "Executed with changes",
    help: "Acted on the recommendation but sized differently or filled at a notably different price.",
  },
  {
    value: "ABANDONED",
    label: "Abandoned",
    help: "Considered it and chose not to act. Notes are the most valuable data here.",
  },
  {
    value: "REJECTED",
    label: "Rejected",
    help: "Disagreed with the recommendation outright. Different from abandoned — REJECTED means the recommendation was wrong.",
  },
];

export function DecisionOutcomeForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<OutcomeOption | null>(null);
  const [executedQuantity, setExecutedQuantity] = useState("");
  const [executedPrice, setExecutedPrice] = useState("");
  const [notes, setNotes] = useState("");

  const isExecuted = outcome === "EXECUTED_AS_RECOMMENDED" || outcome === "EXECUTED_REVISED";

  function submit() {
    if (!outcome) return;
    startTransition(async () => {
      const result = await recordDecisionOutcomeAction({
        eventId,
        outcome,
        executedQuantity: isExecuted ? parseNum(executedQuantity) : null,
        executedPrice: isExecuted ? parseNum(executedPrice) : null,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        toast({ title: "Decision closed", variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <section className="rounded-card border border-border bg-panel p-5">
      <h3 className="text-sm font-semibold">What did you do?</h3>
      <p className="mt-1 text-xs text-muted">
        Recording the outcome closes this decision. Abandoned and rejected outcomes
        are first-class data — that&apos;s how the retrospective learns.
      </p>

      <div className="mt-4 space-y-2">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`block cursor-pointer rounded-[8px] border p-2.5 transition-colors ${
              outcome === opt.value
                ? "border-brand-2 bg-bg/40"
                : "border-border hover:border-border-2"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="outcome"
                value={opt.value}
                checked={outcome === opt.value}
                onChange={() => setOutcome(opt.value)}
                className="h-3.5 w-3.5"
              />
              <span className="text-sm font-semibold">{opt.label}</span>
            </div>
            <p className="ml-5.5 mt-0.5 pl-1 text-xs text-muted">{opt.help}</p>
          </label>
        ))}
      </div>

      {isExecuted && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted">
              Quantity executed
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.001"
              value={executedQuantity}
              onChange={(e) => setExecutedQuantity(e.target.value)}
              placeholder="e.g. 3"
              className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted">
              Fill price (per share)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={executedPrice}
              onChange={(e) => setExecutedPrice(e.target.value)}
              placeholder="e.g. 409.50"
              className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
            />
          </div>
        </div>
      )}

      <div className="mt-4">
        <label className="block text-xs font-semibold text-muted">
          Notes <span className="text-muted-2">(most valuable when abandoning)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Why this outcome? Future-you will use this to spot patterns."
          className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-2 text-sm"
        />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !outcome}
          className="w-full rounded-[8px] bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Close decision"}
        </button>
      </div>
    </section>
  );
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
