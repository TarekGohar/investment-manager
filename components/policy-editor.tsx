"use client";

import { useState, useTransition } from "react";
import { saveInvestmentPolicyAction } from "@/app/actions/policy";
import { useToast } from "@/components/toast-provider";
import { Term } from "@/components/term";
import type {
  InvestmentPolicyData,
  AllocationMap,
  TickerCategoryMap,
} from "@/lib/policy/ips";

type Row = { key: string; value: string };

export function PolicyEditor({
  initial,
  tickers,
}: {
  initial: InvestmentPolicyData;
  tickers: string[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [allocation, setAllocation] = useState<Row[]>(
    toRows(initial.targetAllocation),
  );
  const [geography, setGeography] = useState<Row[]>(
    toRows(initial.targetGeography),
  );
  const [driftThreshold, setDriftThreshold] = useState(numText(initial.driftThresholdPct));
  const [maxSingleName, setMaxSingleName] = useState(numText(initial.maxSingleNameWeightPct));
  const [maxTheme, setMaxTheme] = useState(numText(initial.maxThemeWeightPct));
  const [capReasoning, setCapReasoning] = useState(initial.capReasoning ?? "");
  const [panicSellDd, setPanicSellDd] = useState(numText(initial.panicSellDrawdownPct));
  const [panicSellWindow, setPanicSellWindow] = useState(numText(initial.panicSellWindowDays));
  const [fomoRunup, setFomoRunup] = useState(numText(initial.fomoBuyRunupPct));
  const [fomoWindow, setFomoWindow] = useState(numText(initial.fomoBuyWindowDays));
  const [overtrading, setOvertrading] = useState(numText(initial.overtradingPerMonth));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [tickerCats, setTickerCats] = useState<TickerCategoryMap>(
    { ...initial.tickerCategories },
  );

  function save() {
    const data: InvestmentPolicyData = {
      targetAllocation: fromRows(allocation),
      targetGeography: fromRows(geography),
      driftThresholdPct: parseNum(driftThreshold),
      maxSingleNameWeightPct: parseNum(maxSingleName),
      maxThemeWeightPct: parseNum(maxTheme),
      capReasoning: capReasoning.trim() || null,
      panicSellDrawdownPct: parseNum(panicSellDd),
      panicSellWindowDays: parseInt0(panicSellWindow),
      fomoBuyRunupPct: parseNum(fomoRunup),
      fomoBuyWindowDays: parseInt0(fomoWindow),
      overtradingPerMonth: parseInt0(overtrading),
      tickerCategories: tickerCats,
      notes: notes.trim() || null,
    };
    startTransition(async () => {
      const result = await saveInvestmentPolicyAction(data);
      if (result.ok) {
        toast({ title: "Investment policy saved", variant: "success" });
      } else {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold"><Term>IPS</Term> configuration</h2>
        <span className="text-xs text-muted">
          Set what you want, leave the rest blank — nothing is assumed.
        </span>
      </div>

      <div className="space-y-5 border-t border-border px-4 py-5 md:px-6">
        <Block
          title="Target asset allocation"
          help="Sum should be ~100. Categories are whatever you want to track (e.g. Equity, Bonds, Cash, REITs)."
        >
          <RowEditor
            rows={allocation}
            onChange={setAllocation}
            placeholderKey="Equity"
            placeholderValue="60"
            unit="%"
          />
        </Block>

        <Block
          title="Target geographic split"
          help="Same idea — break by region (e.g. Canada, US, International, Emerging)."
        >
          <RowEditor
            rows={geography}
            onChange={setGeography}
            placeholderKey="Canada"
            placeholderValue="40"
            unit="%"
          />
        </Block>

        <Block
          title={<><Term>Drift threshold</Term> for rebalance alerts</>}
          help={<>If actual vs target diverges by more than this (percentage points), <Term term="Drift">drift</Term> is flagged. Blank disables the check.</>}
        >
          <UnitInput value={driftThreshold} onChange={setDriftThreshold} unit="pp" />
        </Block>

        <Block
          title="Hard concentration caps"
          help="The real discipline. Bucket targets above are aspirational; these caps are non-negotiable. The PM persona will refuse to recommend size changes if either cap is null. Quality compounders are allowed to grow into oversized positions inside the cap — trims happen at the cap, not before."
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted">Per name:</span>
              <UnitInput value={maxSingleName} onChange={setMaxSingleName} unit="% NAV" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted">Per theme:</span>
              <UnitInput value={maxTheme} onChange={setMaxTheme} unit="% NAV" />
            </div>
          </div>
          <textarea
            value={capReasoning}
            onChange={(e) => setCapReasoning(e.target.value)}
            rows={2}
            placeholder="Why these numbers? e.g. '12% per name because I sleep fine in a quality compounder up to here; 30% per theme is my ulcer line.'"
            className="mt-2 w-full rounded-[8px] border border-border bg-panel px-2.5 py-2 text-sm"
          />
        </Block>

        <Block
          title="Panic-sell detector"
          help="Flag any SELL after a drawdown of at least X% over Y days. Both fields required to enable."
        >
          <div className="flex flex-wrap items-center gap-3">
            <UnitInput value={panicSellDd} onChange={setPanicSellDd} unit="% drawdown" />
            <span className="text-xs text-muted">over</span>
            <UnitInput
              value={panicSellWindow}
              onChange={setPanicSellWindow}
              unit="days"
              integer
            />
          </div>
        </Block>

        <Block
          title="FOMO-buy detector"
          help="Flag any BUY after a runup of at least X% over Y days."
        >
          <div className="flex flex-wrap items-center gap-3">
            <UnitInput value={fomoRunup} onChange={setFomoRunup} unit="% runup" />
            <span className="text-xs text-muted">over</span>
            <UnitInput value={fomoWindow} onChange={setFomoWindow} unit="days" integer />
          </div>
        </Block>

        <Block
          title="Overtrading detector"
          help="Flag any calendar month with more than N buy/sell trades."
        >
          <UnitInput value={overtrading} onChange={setOvertrading} unit="trades/mo" integer />
        </Block>

        <Block
          title="Ticker categorization"
          help={<>Map each held ticker to one of your allocation categories above (e.g. &lsquo;Equity&rsquo;). Required for <Term term="Drift">drift</Term> calculation to work.</>}
        >
          {tickers.length === 0 ? (
            <p className="text-xs text-muted">No holdings to categorize yet.</p>
          ) : (
            <div className="space-y-1">
              {tickers.map((t) => (
                <div
                  key={t}
                  className="grid grid-cols-[1fr_2fr] items-center gap-2 rounded-[8px] bg-bg/40 px-2.5 py-1.5"
                >
                  <div className="font-mono text-[13px] font-semibold">{t}</div>
                  <input
                    type="text"
                    value={tickerCats[t] ?? ""}
                    onChange={(e) =>
                      setTickerCats({ ...tickerCats, [t]: e.target.value })
                    }
                    placeholder="e.g. Equity"
                    className="w-full rounded-[6px] border border-border bg-panel px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="Notes" help={<>Free-form <Term>IPS</Term> narrative — risk tolerance, time horizon, exclusions, etc.</>}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Long-term horizon (10+ yrs). Avoid sin stocks. Tilt growth via tech but not >35% any single sector."
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-2 text-sm"
          />
        </Block>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save policy"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Block({
  title,
  help,
  children,
}: {
  title: React.ReactNode;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[13px] font-semibold">{title}</div>
      {help ? <p className="mt-0.5 text-xs text-muted">{help}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function RowEditor({
  rows,
  onChange,
  placeholderKey,
  placeholderValue,
  unit,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  placeholderKey: string;
  placeholderValue: string;
  unit: string;
}) {
  function update(i: number, patch: Partial<Row>) {
    const next = rows.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function add() {
    onChange([...rows, { key: "", value: "" }]);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[1.5fr_1fr_auto] items-center gap-2"
        >
          <input
            type="text"
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={placeholderKey}
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm"
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={placeholderValue}
              className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
            />
            <span className="text-xs text-muted">{unit}</span>
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-xs text-muted hover:text-danger"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs font-semibold text-brand-2 hover:underline"
      >
        + Add category
      </button>
    </div>
  );
}

function UnitInput({
  value,
  onChange,
  unit,
  integer = false,
}: {
  value: string;
  onChange: (v: string) => void;
  unit: string;
  integer?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        step={integer ? "1" : "0.1"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
      />
      <span className="text-xs text-muted">{unit}</span>
    </div>
  );
}

function toRows(map: AllocationMap): Row[] {
  return Object.entries(map).map(([key, value]) => ({
    key,
    value: String(value),
  }));
}

function fromRows(rows: Row[]): AllocationMap {
  const out: AllocationMap = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

function numText(v: number | null): string {
  return v == null ? "" : String(v);
}

function parseNum(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseInt0(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}
