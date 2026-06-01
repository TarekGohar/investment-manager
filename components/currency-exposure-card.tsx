import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";
import type { CurrencyExposureSummary } from "@/lib/portfolio/currency-exposure";

const CCY_FILL: Record<string, string> = {
  CAD: "bg-brand",
  USD: "bg-success",
  EUR: "bg-warning",
  GBP: "bg-danger",
};

export function CurrencyExposureCard({ summary }: { summary: CurrencyExposureSummary }) {
  if (summary.rows.length === 0) return null;

  const usdImpact = summary.oneCentUsdMoveImpactCad;

  return (
    <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[16px] font-semibold">Currency exposure</h3>
        <span className="text-xs text-muted">{summary.rows.length} ccy</span>
      </div>

      {/* Stacked bar */}
      <div className="mb-3 flex h-2 w-full overflow-hidden rounded-full bg-pill">
        {summary.rows.map((r) => (
          <div
            key={r.currency}
            className={`${CCY_FILL[r.currency] ?? "bg-muted"} h-full`}
            style={{ width: `${r.pctOfNav}%` }}
            title={`${r.currency}: ${r.pctOfNav.toFixed(1)}%`}
          />
        ))}
      </div>

      <ul className="space-y-1.5">
        {summary.rows.map((r) => (
          <li key={r.currency} className="flex items-baseline justify-between text-[13px]">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${CCY_FILL[r.currency] ?? "bg-muted"}`}
              />
              <span className="font-mono text-[12px] font-semibold">{r.currency}</span>
              {r.currency !== "CAD" ? (
                <span className="text-[11px] text-muted-2">
                  · native {formatCurrency(r.valueNative)} @ {r.fxRate.toFixed(4)}
                </span>
              ) : null}
            </div>
            <div className="flex gap-3 tabular-nums">
              <span className="text-text">{formatCurrency(r.valueCad)}</span>
              <span className="w-12 text-right text-muted">{formatPercent(r.pctOfNav)}</span>
            </div>
          </li>
        ))}
      </ul>

      {usdImpact > 0 ? (
        <div className="mt-4 rounded-[10px] bg-bg/40 px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          <span className="font-semibold text-text">FX sensitivity:</span> a 1¢ move in
          CAD/USD shifts your CAD NAV by {formatSignedCurrency(usdImpact)}.
          Stronger CAD = lower CAD value for your USD holdings.
        </div>
      ) : null}
    </section>
  );
}
