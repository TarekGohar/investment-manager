"use client";

import { useState, useTransition } from "react";
import { setPerformanceProfileAction } from "@/app/actions/preferences";
import { useToast } from "@/components/toast-provider";
import type { PerformanceProfile } from "@/lib/preferences";

export function PerformanceProfileSection({
  initial,
}: {
  initial: PerformanceProfile;
}) {
  const toast = useToast();
  const [benchmark, setBenchmark] = useState(initial.benchmarkTicker ?? "");
  const [riskFree, setRiskFree] = useState(
    initial.riskFreeRate == null ? "" : (initial.riskFreeRate * 100).toFixed(2),
  );
  const [pending, startTransition] = useTransition();

  function save() {
    const trimmed = benchmark.trim().toUpperCase();
    const rfrInput = riskFree.trim();
    let rfr: number | null = null;
    if (rfrInput) {
      const pct = Number(rfrInput);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        toast({
          title: "Risk-free rate must be between 0 and 100",
          variant: "error",
        });
        return;
      }
      rfr = pct / 100;
    }
    startTransition(async () => {
      const result = await setPerformanceProfileAction({
        benchmarkTicker: trimmed || null,
        riskFreeRate: rfr,
      });
      if (result.ok) {
        toast({ title: "Performance profile saved", variant: "success" });
      } else {
        toast({
          title: "Couldn't save",
          description: result.error,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        These power TWR-vs-benchmark, beta, and Sharpe. Pick a benchmark you
        actually compare yourself to — VFV.TO, XSP.TO, VEQT.TO, SPY, etc. The
        risk-free rate should be your preferred proxy (e.g. Bank of Canada
        3-month T-bill, currently published on the BoC website). Leave blank
        to skip — nothing is assumed.
      </p>

      <div className="rounded-[10px] bg-bg/40 px-3 py-3">
        <label className="block text-[13px] font-semibold">Benchmark ticker</label>
        <p className="mb-2 text-xs text-muted">
          The ticker that defines &ldquo;the market&rdquo; for your beta and
          relative-performance numbers.
        </p>
        <input
          type="text"
          value={benchmark}
          onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
          placeholder="e.g. VFV.TO"
          className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm font-mono"
        />
      </div>

      <div className="rounded-[10px] bg-bg/40 px-3 py-3">
        <label className="block text-[13px] font-semibold">
          Risk-free rate (annualized)
        </label>
        <p className="mb-2 text-xs text-muted">
          Used by Sharpe. Enter as a percentage. Update when BoC moves.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={riskFree}
            onChange={(e) => setRiskFree(e.target.value)}
            placeholder="e.g. 3.50"
            className="w-28 rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
          />
          <span className="text-sm text-muted">%</span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}
