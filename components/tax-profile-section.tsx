"use client";

import { useState, useTransition } from "react";
import { setTaxProfileAction } from "@/app/actions/preferences";
import { useToast } from "@/components/toast-provider";
import { QC_TOP_MARGINAL_RATES_REFERENCE } from "@/lib/canadian/tax-rates";
import {
  TAX_YEAR,
  computeQuebecRates,
  isWizardSupported,
  quebecBracketLabel,
  type ComputedRates,
} from "@/lib/canadian/tax-brackets";
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

type WizardStep = "intro" | "province" | "income" | "review";

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
  const [wizardOpen, setWizardOpen] = useState(false);

  function setRate(key: keyof typeof rates, value: string) {
    setRates((prev) => ({ ...prev, [key]: value }));
  }

  function applyComputedRates(computed: ComputedRates, prov: string) {
    setProvince(prov);
    setRates({
      marginalOrdinaryRate: rateToInput(computed.marginalOrdinaryRate),
      marginalCapGainsRate: rateToInput(computed.marginalCapGainsRate),
      marginalEligibleDividendRate: rateToInput(computed.marginalEligibleDividendRate),
      marginalNonEligibleDividendRate: rateToInput(computed.marginalNonEligibleDividendRate),
    });
    setWizardOpen(false);
    toast({
      title: "Rates filled in",
      description: "Review and click Save tax profile below.",
      variant: "success",
    });
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

      {/* Wizard launcher */}
      <div className="rounded-[10px] border border-brand/30 bg-brand/5 px-3 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold">Don&apos;t know your rates?</div>
            <p className="mt-0.5 text-xs text-muted">
              Answer a few questions and we&apos;ll compute them from {TAX_YEAR} federal +
              provincial brackets.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWizardOpen((v) => !v)}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white"
          >
            {wizardOpen ? "Close wizard" : "Start wizard"}
          </button>
        </div>
        {wizardOpen ? (
          <div className="mt-3">
            <TaxWizard onApply={applyComputedRates} initialProvince={province} />
          </div>
        ) : null}
      </div>

      <div className="rounded-[10px] bg-bg/40 px-3 py-3">
        <label className="block text-[13px] font-semibold">Province</label>
        <p className="mb-2 text-xs text-muted">
          Used to label your profile and (for QC) to power the wizard.
        </p>
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

function TaxWizard({
  onApply,
  initialProvince,
}: {
  onApply: (rates: ComputedRates, province: string) => void;
  initialProvince: string | null;
}) {
  const [step, setStep] = useState<WizardStep>("intro");
  const [province, setProvince] = useState<string>(initialProvince ?? "QC");
  const [employmentIncome, setEmploymentIncome] = useState("");
  const [bonus, setBonus] = useState("");
  const [otherIncome, setOtherIncome] = useState("");
  const [rrspDeduction, setRrspDeduction] = useState("");

  const totalIncome =
    toNum(employmentIncome) + toNum(bonus) + toNum(otherIncome);
  const taxableIncome = Math.max(0, totalIncome - toNum(rrspDeduction));
  const supported = isWizardSupported(province);
  const computed = supported ? computeQuebecRates(taxableIncome) : null;

  if (step === "intro") {
    return (
      <div className="space-y-3 rounded-[8px] border border-border bg-panel p-3">
        <h4 className="text-[14px] font-semibold">How this works</h4>
        <ol className="ml-4 list-decimal space-y-1 text-xs text-muted">
          <li>Tell us your province.</li>
          <li>
            Tell us your approximate taxable income (salary + bonus + other
            income, minus RRSP deduction).
          </li>
          <li>
            We compute the four marginal rates from {TAX_YEAR} federal +
            provincial brackets at your income level. Quebec uses the
            16.5% federal abatement and 2025 dividend tax credit rates.
          </li>
          <li>You review and apply. Nothing is saved until you click Save below.</li>
        </ol>
        <p className="text-xs text-muted-2">
          For best accuracy, use your taxable income from your last Notice of
          Assessment (CRA line 26000). Otherwise an estimate is fine — you can
          adjust the rates manually after.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setStep("province")}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white"
          >
            Get started →
          </button>
        </div>
      </div>
    );
  }

  if (step === "province") {
    return (
      <div className="space-y-3 rounded-[8px] border border-border bg-panel p-3">
        <h4 className="text-[14px] font-semibold">Which province do you reside in?</h4>
        <p className="text-xs text-muted">
          Province of residence on December 31 determines which provincial
          brackets apply.
        </p>
        <select
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          className="w-full rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-sm"
        >
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {!isWizardSupported(province) ? (
          <div className="rounded-[8px] bg-warning/10 px-3 py-2 text-xs text-warning">
            The wizard only computes rates for Quebec right now (provincial
            bracket tables for other provinces aren&apos;t yet wired up). For
            other provinces, use the CRA marginal-rate calculator and enter
            your rates manually below.
          </div>
        ) : null}
        <div className="flex justify-between">
          <button
            type="button"
            onClick={() => setStep("intro")}
            className="text-xs text-muted hover:underline"
          >
            ← Back
          </button>
          <button
            type="button"
            disabled={!isWizardSupported(province)}
            onClick={() => setStep("income")}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    );
  }

  if (step === "income") {
    return (
      <div className="space-y-3 rounded-[8px] border border-border bg-panel p-3">
        <h4 className="text-[14px] font-semibold">Your {TAX_YEAR} income</h4>
        <p className="text-xs text-muted">
          Enter approximate annual amounts in CAD. Anything you don&apos;t know,
          leave blank — we&apos;ll work with what you have.
        </p>

        <Question
          label="Annual employment income (salary)"
          help="T4 box 14, or your gross annual salary."
          value={employmentIncome}
          onChange={setEmploymentIncome}
          placeholder="e.g. 120000"
        />
        <Question
          label="Annual bonus"
          help="Performance bonus, commissions, RSU vesting value. Treated as ordinary income."
          value={bonus}
          onChange={setBonus}
          placeholder="e.g. 20000"
        />
        <Question
          label="Other ordinary income"
          help="Interest, rental net income, business income, RRSP/RRIF withdrawals — anything taxed as ordinary income."
          value={otherIncome}
          onChange={setOtherIncome}
          placeholder="e.g. 5000"
        />
        <Question
          label="RRSP / FHSA deduction you'll claim"
          help="Reduces your taxable income. Leave blank if you're not contributing."
          value={rrspDeduction}
          onChange={setRrspDeduction}
          placeholder="e.g. 15000"
        />

        <div className="rounded-[8px] bg-bg/40 px-3 py-2 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Gross income</span>
            <span className="font-semibold tabular-nums">
              {fmt(totalIncome)}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">RRSP / FHSA deduction</span>
            <span className="tabular-nums">- {fmt(toNum(rrspDeduction))}</span>
          </div>
          <div className="mt-1 border-t border-border pt-1 flex items-baseline justify-between">
            <span className="font-semibold">Taxable income</span>
            <span className="font-semibold tabular-nums">
              {fmt(taxableIncome)}
            </span>
          </div>
          {supported ? (
            <div className="mt-1 text-muted-2">
              Falls in QC bracket: {quebecBracketLabel(taxableIncome)}
            </div>
          ) : null}
        </div>

        <div className="flex justify-between">
          <button
            type="button"
            onClick={() => setStep("province")}
            className="text-xs text-muted hover:underline"
          >
            ← Back
          </button>
          <button
            type="button"
            disabled={taxableIncome === 0}
            onClick={() => setStep("review")}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Compute rates →
          </button>
        </div>
      </div>
    );
  }

  // review
  if (!computed) {
    return (
      <div className="rounded-[8px] border border-border bg-panel p-3 text-xs text-muted">
        Wizard not available for {province}. Use the manual form below.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[8px] border border-border bg-panel p-3">
      <h4 className="text-[14px] font-semibold">Your computed marginal rates</h4>
      <p className="text-xs text-muted">
        Combined federal + Quebec marginal rates at a taxable income of{" "}
        <span className="font-semibold tabular-nums">{fmt(taxableIncome)}</span>{" "}
        ({TAX_YEAR} brackets).
      </p>

      <div className="space-y-1.5">
        <ResultRow label="Ordinary income" rate={computed.marginalOrdinaryRate} />
        <ResultRow
          label="Capital gains"
          rate={computed.marginalCapGainsRate}
          hint="ordinary × 50% inclusion"
        />
        <ResultRow
          label="Eligible dividends"
          rate={computed.marginalEligibleDividendRate}
          hint="38% gross-up, fed DTC 15.0198%, QC DTC 11.70%"
        />
        <ResultRow
          label="Non-eligible dividends"
          rate={computed.marginalNonEligibleDividendRate}
          hint="15% gross-up, fed DTC 9.0301%, QC DTC 3.42%"
        />
      </div>

      <p className="text-xs text-muted-2">
        These are at-bracket marginals (rate on the next dollar). For a more
        precise figure across a large dividend or gain, you may want a tax
        professional. You can always edit individual rates after applying.
      </p>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep("income")}
          className="text-xs text-muted hover:underline"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => onApply(computed, province)}
          className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white"
        >
          Apply to my profile
        </button>
      </div>
    </div>
  );
}

function Question({
  label,
  help,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold">{label}</label>
      <p className="mb-1 text-xs text-muted-2">{help}</p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="100"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-40 rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-sm tabular-nums"
        />
      </div>
    </div>
  );
}

function ResultRow({
  label,
  rate,
  hint,
}: {
  label: string;
  rate: number;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between rounded-[8px] bg-bg/40 px-3 py-1.5">
      <div>
        <div className="text-[13px] font-semibold">{label}</div>
        {hint ? <div className="text-[11px] text-muted-2">{hint}</div> : null}
      </div>
      <div className="text-[14px] font-semibold tabular-nums">
        {(rate * 100).toFixed(2)}%
      </div>
    </div>
  );
}

function toNum(s: string): number {
  if (!s.trim()) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function fmt(n: number): string {
  return n.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
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
