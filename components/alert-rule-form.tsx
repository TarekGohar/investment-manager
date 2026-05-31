"use client";

import { useState, useTransition } from "react";
import { createAlertAction } from "@/app/actions/alerts";
import { useToast } from "@/components/toast-provider";
import { RULE_DESCRIPTION, RULE_LABEL, SCOPE_LABEL } from "@/lib/signals/types";
import type { AlertRule, AlertScope } from "@/generated/prisma";

type RuleMeta = {
  value: AlertRule;
  paramKind: "thresholdPct" | "multipleX" | "none";
  defaultParam?: number;
  paramLabel?: string;
  paramHelp?: string;
};

const RULES: RuleMeta[] = [
  {
    value: "PRICE_MOVE",
    paramKind: "thresholdPct",
    defaultParam: 5,
    paramLabel: "Day-change %",
    paramHelp: "Fires when |day change| crosses this percent.",
  },
  {
    value: "DRAWDOWN",
    paramKind: "thresholdPct",
    defaultParam: 10,
    paramLabel: "Drawdown %",
    paramHelp: "Fires when current price is at least this far below avg cost.",
  },
  {
    value: "CONCENTRATION",
    paramKind: "thresholdPct",
    defaultParam: 25,
    paramLabel: "Position weight %",
    paramHelp: "Fires when a single position grows past this share of total portfolio.",
  },
  {
    value: "MA_CROSS_50",
    paramKind: "none",
    paramHelp: "Fires when daily close crosses the 50-day simple moving average.",
  },
  {
    value: "MA_CROSS_200",
    paramKind: "none",
    paramHelp: "Fires when daily close crosses the 200-day simple moving average.",
  },
  {
    value: "VOLUME_SPIKE",
    paramKind: "multipleX",
    defaultParam: 3,
    paramLabel: "Multiple of 30-day avg volume",
    paramHelp: "Fires when today's volume exceeds N× the trailing 30-day average.",
  },
  {
    value: "NEWS_MATERIAL",
    paramKind: "none",
    paramHelp:
      "Fires when AI classifies a fresh headline as MATERIAL or CRITICAL. Requires the News-classification preference to be on.",
  },
];

const SCOPE_FOR_RULE: Record<AlertRule, AlertScope[]> = {
  PRICE_MOVE: ["HOLDING", "TICKER"],
  DRAWDOWN: ["HOLDING", "TICKER"],
  CONCENTRATION: ["PORTFOLIO"],
  MA_CROSS_50: ["HOLDING", "TICKER"],
  MA_CROSS_200: ["HOLDING", "TICKER"],
  VOLUME_SPIKE: ["HOLDING", "TICKER"],
  NEWS_MATERIAL: ["HOLDING", "TICKER"],
};

const inputClass =
  "w-full rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-muted-2 focus:border-brand";

export function AlertRuleForm({
  tickerHints,
  onSaved,
}: {
  tickerHints: string[];
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [rule, setRule] = useState<AlertRule>("PRICE_MOVE");
  const [scope, setScope] = useState<AlertScope>("HOLDING");
  const [ticker, setTicker] = useState("");
  const [threshold, setThreshold] = useState<string>(
    String(RULES.find((r) => r.value === "PRICE_MOVE")!.defaultParam ?? ""),
  );
  const [pending, startTransition] = useTransition();

  const ruleMeta = RULES.find((r) => r.value === rule)!;
  const allowedScopes = SCOPE_FOR_RULE[rule];

  function changeRule(next: AlertRule) {
    setRule(next);
    const allowed = SCOPE_FOR_RULE[next];
    if (!allowed.includes(scope)) setScope(allowed[0]);
    const meta = RULES.find((r) => r.value === next)!;
    setThreshold(meta.defaultParam != null ? String(meta.defaultParam) : "");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("rule", rule);
    fd.set("scope", scope);

    if (ruleMeta.paramKind === "none") {
      // Send a benign placeholder; server stores params freely as JSON
      fd.set("thresholdPct", "0");
    } else {
      fd.set("thresholdPct", threshold);
    }

    startTransition(async () => {
      const result = await createAlertAction(fd);
      if (result.ok) {
        toast({
          title: "Alert created",
          description: `${RULE_LABEL[rule]} · ${SCOPE_LABEL[scope]}`,
          variant: "success",
        });
        setTicker("");
        setThreshold(ruleMeta.defaultParam != null ? String(ruleMeta.defaultParam) : "");
        onSaved?.();
      } else {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-card border border-border bg-panel p-4 md:p-6"
    >
      <h3 className="mb-4 text-[16px] font-semibold">New alert</h3>

      <Field label="Rule">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {RULES.map((r) => {
            const active = r.value === rule;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => changeRule(r.value)}
                className={`rounded-[12px] border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "border-brand bg-brand/10 text-text"
                    : "border-border bg-bg text-soft hover:bg-panel-2"
                }`}
              >
                <div className="text-[14px] font-semibold">{RULE_LABEL[r.value]}</div>
                <div className="mt-0.5 text-xs text-muted">{RULE_DESCRIPTION[r.value]}</div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Applies to">
        <div className="flex flex-wrap gap-2">
          {allowedScopes.map((s) => {
            const active = s === scope;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                  active
                    ? "bg-brand text-white"
                    : "border border-border bg-bg text-muted hover:bg-panel-2"
                }`}
              >
                {SCOPE_LABEL[s]}
              </button>
            );
          })}
        </div>
      </Field>

      {scope === "TICKER" ? (
        <Field label="Ticker">
          <input
            name="ticker"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={10}
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL"
            list="ticker-hints"
            className={`${inputClass} font-mono uppercase`}
          />
          <datalist id="ticker-hints">
            {tickerHints.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
      ) : null}

      {ruleMeta.paramKind === "thresholdPct" ? (
        <Field label={ruleMeta.paramLabel ?? "Threshold"} help={ruleMeta.paramHelp}>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              required
              min="0"
              max="1000"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className={inputClass}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              %
            </span>
          </div>
        </Field>
      ) : ruleMeta.paramKind === "multipleX" ? (
        <Field label={ruleMeta.paramLabel ?? "Multiple"} help={ruleMeta.paramHelp}>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              required
              min="1"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className={inputClass}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              ×
            </span>
          </div>
        </Field>
      ) : (
        <Field label="Configuration" help={ruleMeta.paramHelp}>
          <div className="rounded-[10px] border border-border bg-bg px-3 py-2.5 text-sm text-muted">
            No threshold needed.
          </div>
        </Field>
      )}

      <Field label="Notify by">
        <label className="flex items-center gap-2 text-sm text-soft">
          <input
            type="checkbox"
            name="emailChannel"
            value="true"
            className="h-4 w-4 rounded border-border bg-bg accent-brand"
          />
          Email me when this fires
          <span className="ml-1 text-xs text-muted-2">(Mailgun must be configured)</span>
        </label>
      </Field>

      <button
        type="submit"
        disabled={pending || (scope === "TICKER" && !ticker.trim())}
        className="mt-2 inline-flex items-center justify-center rounded-[28px] bg-gradient-to-r from-brand to-brand-3 px-5 py-3 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving…" : "Create alert"}
      </button>
    </form>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-4 block last:mb-3">
      <span className="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {help ? <span className="mt-1 block text-xs text-muted-2">{help}</span> : null}
    </label>
  );
}
