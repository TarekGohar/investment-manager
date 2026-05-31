"use client";

import { useEffect, useState } from "react";
import {
  TAX_YEAR,
  computeQuebecRates,
  isWizardSupported,
  quebecBracketLabel,
  type ComputedRates,
} from "@/lib/canadian/tax-brackets";

const PROVINCES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU",
  "ON", "PE", "QC", "SK", "YT",
] as const;

type WizardStep = "intro" | "province" | "income" | "review";

export function TaxProfileWizard({
  open,
  initialProvince,
  onApply,
  onClose,
}: {
  open: boolean;
  initialProvince: string | null;
  onApply: (rates: ComputedRates, province: string) => void;
  onClose: () => void;
}) {
  // Lock scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[22px] border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-[18px] font-semibold">Tax profile wizard</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel-2 hover:text-text"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <WizardBody
            initialProvince={initialProvince}
            onApply={(rates, province) => {
              onApply(rates, province);
              onClose();
            }}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

function WizardBody({
  initialProvince,
  onApply,
  onClose,
}: {
  initialProvince: string | null;
  onApply: (rates: ComputedRates, province: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<WizardStep>("intro");
  const [province, setProvince] = useState<string>(initialProvince ?? "QC");
  const [employmentIncome, setEmploymentIncome] = useState("");
  const [bonus, setBonus] = useState("");
  const [otherIncome, setOtherIncome] = useState("");

  // Taxable income for marginal-rate purposes = gross ordinary income before
  // RRSP / FHSA deductions. The whole point of these rates is to tell the
  // user how much a contribution *would* save them — so we compute the
  // marginal rate on the next pre-deduction dollar.
  const taxableIncome =
    toNum(employmentIncome) + toNum(bonus) + toNum(otherIncome);
  const supported = isWizardSupported(province);
  const computed = supported ? computeQuebecRates(taxableIncome) : null;

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <StepHeader current={1} total={4} title="How this works" />
        <ol className="ml-4 list-decimal space-y-1.5 text-sm text-soft">
          <li>Tell us your province.</li>
          <li>
            Tell us your ordinary income before deductions (salary, bonus,
            interest, etc.).
          </li>
          <li>
            We compute four marginal rates from {TAX_YEAR} federal +
            provincial brackets — including the Quebec 16.5% abatement and
            current dividend tax credit rates.
          </li>
          <li>
            You review and apply. Nothing is saved until you click{" "}
            <span className="font-semibold">Save tax profile</span> on the
            settings page.
          </li>
        </ol>
        <p className="text-xs text-muted">
          We deliberately don&apos;t ask what you&apos;ll contribute to your
          RRSP or FHSA — figuring out the optimal contribution is one of the
          things this app is for. The marginal rate here is the rate on your
          next pre-deduction dollar, i.e. exactly what a $1 RRSP / FHSA
          contribution would save you in tax.
        </p>
        <Footer
          onBack={onClose}
          backLabel="Cancel"
          onNext={() => setStep("province")}
          nextLabel="Get started →"
        />
      </div>
    );
  }

  if (step === "province") {
    const valid = isWizardSupported(province);
    return (
      <div className="space-y-4">
        <StepHeader current={2} total={4} title="Where do you live?" />
        <p className="text-sm text-muted">
          Province of residence on December 31 determines which provincial
          brackets apply.
        </p>
        <select
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          className="w-full rounded-[8px] border border-border bg-bg px-3 py-2 text-sm"
        >
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {!valid ? (
          <div className="rounded-[8px] border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
            The wizard only computes rates for Quebec right now — provincial
            bracket tables for other provinces aren&apos;t yet wired up. For
            other provinces, use the{" "}
            <a
              href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              CRA marginal-rate page
            </a>{" "}
            and enter your rates manually.
          </div>
        ) : null}
        <Footer
          onBack={() => setStep("intro")}
          onNext={() => setStep("income")}
          nextDisabled={!valid}
        />
      </div>
    );
  }

  if (step === "income") {
    return (
      <div className="space-y-4">
        <StepHeader current={3} total={4} title={`Your ${TAX_YEAR} income`} />
        <p className="text-sm text-muted">
          Approximate annual amounts in CAD, before any deductions. Leave
          anything you don&apos;t know blank.
        </p>

        <div className="space-y-3">
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
            help="Interest, rental net income, business income, RRSP/RRIF withdrawals."
            value={otherIncome}
            onChange={setOtherIncome}
            placeholder="e.g. 5000"
          />
        </div>

        <div className="rounded-[10px] border border-border bg-bg/40 px-3 py-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">
              Ordinary income (pre-deduction)
            </span>
            <span className="font-semibold tabular-nums">
              {fmt(taxableIncome)}
            </span>
          </div>
          {supported ? (
            <div className="mt-1 text-xs text-muted-2">
              Falls in QC bracket: {quebecBracketLabel(taxableIncome)}
            </div>
          ) : null}
        </div>

        <Footer
          onBack={() => setStep("province")}
          onNext={() => setStep("review")}
          nextLabel="Compute rates →"
          nextDisabled={taxableIncome === 0}
        />
      </div>
    );
  }

  // review
  if (!computed) {
    return (
      <div className="rounded-[8px] border border-border bg-bg/40 p-3 text-sm text-muted">
        Wizard not available for {province}. Use the manual form on the
        settings page.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StepHeader current={4} total={4} title="Your computed marginal rates" />
      <p className="text-sm text-muted">
        Combined federal + Quebec marginal rates at an ordinary income of{" "}
        <span className="font-semibold text-text tabular-nums">
          {fmt(taxableIncome)}
        </span>{" "}
        ({TAX_YEAR} brackets). These represent the tax on your next
        pre-deduction dollar — the rate at which an RRSP / FHSA contribution
        would save tax.
      </p>

      <div className="space-y-2">
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
        At-bracket marginal rates (rate on the next dollar). For very large
        gains or dividends, you may cross into the next bracket. You can edit
        any of these by hand after applying.
      </p>

      <Footer
        onBack={() => setStep("income")}
        onNext={() => onApply(computed, province)}
        nextLabel="Apply to my profile"
      />
    </div>
  );
}

function StepHeader({
  current,
  total,
  title,
}: {
  current: number;
  total: number;
  title: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Step {current} of {total}
      </div>
      <h3 className="mt-1 text-[18px] font-semibold">{title}</h3>
    </div>
  );
}

function Footer({
  onBack,
  backLabel,
  onNext,
  nextLabel,
  nextDisabled,
}: {
  onBack: () => void;
  backLabel?: string;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted hover:text-text hover:underline"
      >
        {backLabel ?? "← Back"}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded-[8px] bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {nextLabel ?? "Next →"}
      </button>
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
      <label className="block text-[13px] font-semibold">{label}</label>
      <p className="mb-1.5 text-xs text-muted-2">{help}</p>
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
          className="w-44 rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-sm tabular-nums"
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
    <div className="flex items-baseline justify-between rounded-[10px] border border-border bg-bg/40 px-3 py-2">
      <div>
        <div className="text-[14px] font-semibold">{label}</div>
        {hint ? <div className="text-[11px] text-muted-2">{hint}</div> : null}
      </div>
      <div className="text-[16px] font-semibold tabular-nums">
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
