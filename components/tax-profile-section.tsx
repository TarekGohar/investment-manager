"use client";

import { useState, useTransition } from "react";
import { setTaxProfileAction } from "@/app/actions/preferences";
import { useToast } from "@/components/toast-provider";
import { QC_TOP_MARGINAL_RATES_REFERENCE } from "@/lib/canadian/tax-rates";
import type { TaxProfile } from "@/lib/preferences";

const PROVINCES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU",
  "ON", "PE", "QC", "SK", "YT",
] as const;

const FIELDS: Array<{
  key: Exclude<keyof TaxProfile, "province">;
  label: string;
  hint: string;
  qcRef: number;
}> = [
  {
    key: "marginalOrdinaryRate",
    label: "Ordinary income rate",
    hint: "Combined fed + prov on your next dollar of salary / interest / RRSP withdrawal.",
    qcRef: QC_TOP_MARGINAL_RATES_REFERENCE.ordinaryIncome,
  },
  {
    key: "marginalCapGainsRate",
    label: "Capital gains rate",
    hint: "Effective rate on a realized capital gain — already accounts for the 50% inclusion. Drives TLH dollar sizing.",
    qcRef: QC_TOP_MARGINAL_RATES_REFERENCE.capitalGains,
  },
  {
    key: "marginalEligibleDividendRate",
    label: "Eligible dividend rate",
    hint: "Most Canadian public-company dividends. After the gross-up and dividend tax credit.",
    qcRef: QC_TOP_MARGINAL_RATES_REFERENCE.eligibleDividend,
  },
  {
    key: "marginalNonEligibleDividendRate",
    label: "Non-eligible dividend rate",
    hint: "CCPC small-business-pool dividends. Higher than eligible.",
    qcRef: QC_TOP_MARGINAL_RATES_REFERENCE.nonEligibleDividend,
  },
];

export function TaxProfileSection({ initial }: { initial: TaxProfile }) {
  const toast = useToast();
  const [province, setProvince] = useState<string | null>(initial.province);
  const [rates, setRates] = useState({
    marginalOrdinaryRate: rateToInput(initial.marginalOrdinaryRate),
    marginalCapGainsRate: rateToInput(initial.marginalCapGainsRate),
    marginalEligibleDividendRate: rateToInput(initial.marginalEligibleDividendRate),
    marginalNonEligibleDividendRate: rateToInput(initial.marginalNonEligibleDividendRate),
  });
  const [pending, startTransition] = useTransition();

  function setRate(key: keyof typeof rates, value: string) {
    setRates((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    const next: TaxProfile = {
      province: province && province.trim() ? province : null,
      marginalOrdinaryRate: inputToRate(rates.marginalOrdinaryRate),
      marginalCapGainsRate: inputToRate(rates.marginalCapGainsRate),
      marginalEligibleDividendRate: inputToRate(rates.marginalEligibleDividendRate),
      marginalNonEligibleDividendRate: inputToRate(rates.marginalNonEligibleDividendRate),
    };
    startTransition(async () => {
      const result = await setTaxProfileAction(next);
      if (result.ok) {
        toast({ title: "Tax profile saved", variant: "success" });
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
        Your combined federal + provincial marginal rates. We use these for
        TLH dollar sizing, after-tax dividend math, and RRSP withdrawal
        analysis. Nothing is assumed — fields left blank stay blank in the UI.
      </p>

      <div className="rounded-[10px] bg-bg/40 px-3 py-3">
        <label className="block text-[13px] font-semibold">Province</label>
        <p className="mb-2 text-xs text-muted">Optional. Used only as a label.</p>
        <select
          value={province ?? ""}
          onChange={(e) => setProvince(e.target.value || null)}
          className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm"
        >
          <option value="">—</option>
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {FIELDS.map((f) => (
        <div key={f.key} className="rounded-[10px] bg-bg/40 px-3 py-3">
          <label className="block text-[13px] font-semibold">{f.label}</label>
          <p className="mb-2 text-xs text-muted">{f.hint}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              value={rates[f.key]}
              onChange={(e) => setRate(f.key, e.target.value)}
              placeholder={(f.qcRef * 100).toFixed(2)}
              className="w-28 rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
            />
            <span className="text-sm text-muted">%</span>
            <span className="text-xs text-muted-2">
              QC top-bracket reference: {(f.qcRef * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save tax profile"}
        </button>
      </div>
    </div>
  );
}

function rateToInput(rate: number | null): string {
  if (rate == null) return "";
  return (rate * 100).toFixed(2);
}

function inputToRate(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return pct / 100;
}
