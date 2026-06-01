"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveRoCAllocationAction,
  deleteRoCAllocationAction,
  applyRoCAllocationAction,
} from "@/app/actions/roc-allocation";
import { useToast } from "@/components/toast-provider";
import type { RoCAllocationData } from "@/lib/canadian/reit-decomposition";

const inputClass =
  "w-full rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-brand tabular-nums";

export function RoCAllocationSection({
  initial,
  currentYear,
}: {
  initial: RoCAllocationData[];
  currentYear: number;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted">
        Canadian REITs / income trusts publish a T3 breakdown each March
        showing what % of last year&apos;s distributions was each tax type.
        Paste the breakdown here and click <em>Apply</em> to re-bucket the
        year&apos;s DIVIDEND rows. Return-of-capital portions reduce ACB
        instead of being income.
      </p>

      {initial.length === 0 && !adding ? (
        <div className="rounded-[10px] border border-dashed border-border bg-bg/40 px-4 py-6 text-center text-sm text-muted">
          No T3 allocations entered yet.
        </div>
      ) : null}

      {initial.length > 0 ? (
        <ul className="space-y-2">
          {initial.map((a) => (
            <Row key={a.id ?? `${a.ticker}-${a.year}`} initial={a} />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <NewAllocationForm
          currentYear={currentYear}
          onSaved={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-[10px] border border-border bg-bg/40 px-3 py-2 text-[13px] font-semibold hover:bg-bg"
        >
          + Add T3 allocation
        </button>
      )}
    </div>
  );
}

function Row({ initial }: { initial: RoCAllocationData }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function applyNow() {
    startTransition(async () => {
      const result = await applyRoCAllocationAction({
        ticker: initial.ticker,
        year: initial.year,
      });
      if (!result.ok) {
        toast({ title: "Couldn't apply", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: "Reclassification applied",
        description: `${result.data.originalCount} DIVIDEND rows → ${result.data.createdCount} fractional rows (${result.data.totalProcessed.toFixed(2)} processed).`,
        variant: "success",
      });
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (!initial.id) return;
    startTransition(async () => {
      const result = await deleteRoCAllocationAction(initial.id!);
      if (!result.ok) {
        toast({ title: "Couldn't delete", description: result.error, variant: "error" });
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="rounded-[10px] border border-border bg-bg/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[14px] font-semibold">
          <span className="font-mono">{initial.ticker}</span>{" "}
          <span className="text-muted-2">· {initial.year}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {initial.appliedAt ? (
            <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success">
              Applied
            </span>
          ) : (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">
              Not applied
            </span>
          )}
          <button
            type="button"
            onClick={applyNow}
            disabled={pending}
            className="rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {pending ? "Applying…" : initial.appliedAt ? "Re-apply" : "Apply"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              confirming
                ? "bg-danger/20 text-danger"
                : "bg-pill text-muted hover:text-danger"
            }`}
          >
            {confirming ? "Confirm" : "Delete"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[12px] tabular-nums">
        <Stat label="Eligible div" pct={initial.eligibleDividendPct} />
        <Stat label="Non-eligible div" pct={initial.nonEligibleDividendPct} />
        <Stat label="Interest" pct={initial.interestPct} />
        <Stat label="RoC" pct={initial.returnOfCapitalPct} />
        <Stat label="Capital gain" pct={initial.capitalGainPct} />
        <Stat label="Other" pct={initial.otherPct} />
      </div>
      {initial.notes ? (
        <div className="mt-2 text-[11px] text-muted-2">{initial.notes}</div>
      ) : null}
    </li>
  );
}

function Stat({ label, pct }: { label: string; pct: number }) {
  return (
    <div className={pct > 0 ? "" : "text-muted-2"}>
      <span className="text-muted-2">{label}: </span>
      <span className="font-semibold">{pct.toFixed(2)}%</span>
    </div>
  );
}

function NewAllocationForm({
  currentYear,
  onSaved,
  onCancel,
}: {
  currentYear: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [ticker, setTicker] = useState("");
  const [year, setYear] = useState(String(currentYear - 1));
  const [eligible, setEligible] = useState("0");
  const [nonEligible, setNonEligible] = useState("0");
  const [interest, setInterest] = useState("0");
  const [roc, setRoc] = useState("0");
  const [capGain, setCapGain] = useState("0");
  const [other, setOther] = useState("0");
  const [notes, setNotes] = useState("");

  const total =
    Number(eligible) +
    Number(nonEligible) +
    Number(interest) +
    Number(roc) +
    Number(capGain) +
    Number(other);

  function save() {
    if (!ticker.trim()) {
      toast({ title: "Ticker required", variant: "error" });
      return;
    }
    startTransition(async () => {
      const result = await saveRoCAllocationAction({
        ticker: ticker.trim().toUpperCase(),
        year: Number(year),
        eligibleDividendPct: Number(eligible),
        nonEligibleDividendPct: Number(nonEligible),
        interestPct: Number(interest),
        returnOfCapitalPct: Number(roc),
        capitalGainPct: Number(capGain),
        otherPct: Number(other),
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "T3 allocation saved", variant: "success" });
      onSaved();
      router.refresh();
    });
  }

  const totalOk = Math.abs(total - 100) < 0.5;

  return (
    <div className="rounded-[10px] border border-brand/30 bg-brand/5 p-3">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-muted">Ticker</span>
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="REI.UN"
            className={`${inputClass} font-mono uppercase`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-muted">Tax year</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <PctField label="Eligible div %" value={eligible} setValue={setEligible} />
        <PctField label="Non-eligible div %" value={nonEligible} setValue={setNonEligible} />
        <PctField label="Interest %" value={interest} setValue={setInterest} />
        <PctField label="RoC %" value={roc} setValue={setRoc} />
        <PctField label="Capital gain %" value={capGain} setValue={setCapGain} />
        <PctField label="Other %" value={other} setValue={setOther} />
      </div>
      <div className={`mt-2 text-[11px] ${totalOk ? "text-muted" : "text-warning font-semibold"}`}>
        Sum: {total.toFixed(2)}% {totalOk ? "✓" : "(should be ~100)"}
      </div>
      <label className="mt-2 block">
        <span className="text-[11px] font-semibold text-muted">Notes (optional)</span>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="From trust's T3 supplement, Mar 2026"
          className={inputClass}
        />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[8px] border border-border px-3 py-1.5 text-[13px] font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || !totalOk}
          className="rounded-[8px] bg-brand px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function PctField({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.001"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}
