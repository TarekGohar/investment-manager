"use client";

import { useState, useTransition } from "react";
import {
  saveThesisAction,
  reviewThesisAction,
  deleteThesisAction,
} from "@/app/actions/policy";
import { useToast } from "@/components/toast-provider";
import { Markdown } from "@/components/markdown";
import type { ThesisRecord } from "@/lib/policy/thesis";

const STATUS_OPTIONS: ThesisRecord["status"][] = [
  "ACTIVE",
  "TRIMMED",
  "EXITED",
  "INVALIDATED",
];

export function ThesisCard({
  ticker,
  initial,
}: {
  ticker: string;
  initial: ThesisRecord | null;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(!initial);
  const [thesis, setThesis] = useState<ThesisRecord | null>(initial);
  const [body, setBody] = useState(initial?.body ?? "");
  const [invalidation, setInvalidation] = useState(initial?.invalidationCriteria ?? "");
  const [priceTarget, setPriceTarget] = useState(
    initial?.priceTargetCad != null ? String(initial.priceTargetCad) : "",
  );
  const [horizon, setHorizon] = useState(
    initial?.horizonMonths != null ? String(initial.horizonMonths) : "",
  );
  const [status, setStatus] = useState<ThesisRecord["status"]>(
    initial?.status ?? "ACTIVE",
  );
  const [pending, startTransition] = useTransition();
  const [reviewing, startReview] = useTransition();

  function save() {
    if (body.trim().length < 10) {
      toast({ title: "Thesis must be at least 10 characters", variant: "error" });
      return;
    }
    startTransition(async () => {
      const result = await saveThesisAction({
        ticker,
        body: body.trim(),
        invalidationCriteria: invalidation.trim() || null,
        priceTargetCad: priceTarget.trim() ? Number(priceTarget) : null,
        horizonMonths: horizon.trim() ? Number(horizon) : null,
        status,
      });
      if (result.ok) {
        toast({ title: "Thesis saved", variant: "success" });
        setEditing(false);
        // Optimistic local update — server has authoritative copy
        setThesis({
          id: thesis?.id ?? "",
          ticker,
          body: body.trim(),
          invalidationCriteria: invalidation.trim() || null,
          priceTargetCad: priceTarget.trim() ? Number(priceTarget) : null,
          horizonMonths: horizon.trim() ? Number(horizon) : null,
          status,
          lastAiReview: thesis?.lastAiReview ?? null,
          lastReviewedAt: thesis?.lastReviewedAt ?? null,
          createdAt: thesis?.createdAt ?? new Date(),
          updatedAt: new Date(),
        });
      } else {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  function recheck() {
    startReview(async () => {
      const result = await reviewThesisAction(ticker);
      if (result.ok) {
        toast({ title: "Thesis re-checked", variant: "success" });
        setThesis(thesis ? { ...thesis, lastAiReview: result.body, lastReviewedAt: new Date() } : thesis);
      } else {
        toast({ title: "AI review failed", description: result.error, variant: "error" });
      }
    });
  }

  function removeThesis() {
    if (!confirm(`Delete thesis for ${ticker}?`)) return;
    startTransition(async () => {
      const result = await deleteThesisAction(ticker);
      if (result.ok) {
        toast({ title: "Thesis deleted", variant: "success" });
        setThesis(null);
        setBody("");
        setInvalidation("");
        setPriceTarget("");
        setHorizon("");
        setStatus("ACTIVE");
        setEditing(true);
      } else {
        toast({ title: "Couldn't delete", description: result.error, variant: "error" });
      }
    });
  }

  if (editing) {
    return (
      <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
        <h3 className="mb-3 text-[16px] font-semibold">
          {thesis ? "Edit thesis" : "Write thesis"}
        </h3>
        <p className="mb-3 text-xs text-muted">
          Why do you own {ticker}? What specifically would make you exit? Future-you will thank present-you.
        </p>

        <label className="mb-2 block">
          <span className="text-xs font-semibold text-muted">Thesis</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Bull case, primary growth driver, why now…"
            className="mt-1 w-full rounded-[8px] border border-border bg-bg px-2.5 py-2 text-sm"
          />
        </label>
        <label className="mb-2 block">
          <span className="text-xs font-semibold text-muted">Invalidation criteria</span>
          <textarea
            value={invalidation}
            onChange={(e) => setInvalidation(e.target.value)}
            rows={2}
            placeholder="What evidence would force you out?"
            className="mt-1 w-full rounded-[8px] border border-border bg-bg px-2.5 py-2 text-sm"
          />
        </label>
        <div className="mb-2 grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs font-semibold text-muted">Price target (CAD)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={priceTarget}
              onChange={(e) => setPriceTarget(e.target.value)}
              className="mt-1 w-full rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted">Horizon (months)</span>
            <input
              type="number"
              step="1"
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              className="mt-1 w-full rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ThesisRecord["status"])}
              className="mt-1 w-full rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          {thesis ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-[8px] border border-border bg-panel px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save thesis"}
          </button>
        </div>
      </section>
    );
  }

  if (!thesis) return null;

  return (
    <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold">Thesis</h3>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
            {thesis.status}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-brand-2 hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={removeThesis}
            className="text-xs text-muted hover:text-danger"
            disabled={pending}
          >
            Delete
          </button>
        </div>
      </div>

      <p className="text-[14px] leading-relaxed text-soft">{thesis.body}</p>
      {thesis.invalidationCriteria ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          <span className="font-semibold text-muted-2">Invalidation: </span>
          {thesis.invalidationCriteria}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-muted-2">
        {thesis.priceTargetCad != null ? (
          <span>Target ${thesis.priceTargetCad.toFixed(2)}</span>
        ) : null}
        {thesis.horizonMonths != null ? (
          <span>Horizon {thesis.horizonMonths}mo</span>
        ) : null}
        {thesis.lastReviewedAt ? (
          <span>
            Last AI review{" "}
            {new Date(thesis.lastReviewedAt).toLocaleDateString("en-CA", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={recheck}
          disabled={reviewing}
          className="rounded-[8px] border border-border bg-bg/40 px-3 py-1.5 text-xs font-semibold hover:bg-bg disabled:opacity-50"
        >
          {reviewing ? "Re-checking…" : "Re-check thesis with AI"}
        </button>
      </div>

      {thesis.lastAiReview ? (
        <div className="mt-4 rounded-[10px] border border-border bg-bg/40 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Latest AI review
          </div>
          <div className="prose-pm">
            <Markdown>{thesis.lastAiReview}</Markdown>
          </div>
        </div>
      ) : null}
    </section>
  );
}
