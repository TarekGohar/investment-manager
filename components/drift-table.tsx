import { formatCurrency, formatPercent } from "@/lib/format";
import type { AllocationRow } from "@/lib/policy/ips";

export function DriftTable({
  drift,
  thresholdPct,
}: {
  drift: {
    rows: AllocationRow[];
    totalMarketValue: number;
    uncategorized: Array<{ ticker: string; marketValue: number }>;
  };
  thresholdPct: number | null;
}) {
  const anyTargets = drift.rows.length > 0;
  const exceeded = drift.rows.filter((r) => r.exceedsThreshold).length;

  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Allocation vs target</h2>
        {anyTargets && thresholdPct != null ? (
          <span className="text-xs text-muted">
            {exceeded} of {drift.rows.length} categor
            {drift.rows.length === 1 ? "y" : "ies"} drift &gt; ±
            {thresholdPct.toFixed(1)}pp
          </span>
        ) : null}
      </div>

      {!anyTargets ? (
        <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
          No target allocation set. Configure your IPS below to start tracking
          drift.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
              <div>Category</div>
              <div className="text-right">Target</div>
              <div className="text-right">Actual</div>
              <div className="text-right">Drift</div>
            </div>
            {drift.rows.map((r) => (
              <div
                key={r.category}
                className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-3 border-t border-border px-4 py-3 md:px-6"
              >
                <div className="text-[14px] font-semibold">{r.category}</div>
                <div className="text-right text-[14px] tabular-nums text-muted">
                  {r.targetPct.toFixed(1)}%
                </div>
                <div className="text-right text-[14px] tabular-nums">
                  {r.actualPct.toFixed(1)}%
                </div>
                <div
                  className={`text-right text-[14px] font-semibold tabular-nums ${
                    r.exceedsThreshold
                      ? r.driftPct > 0
                        ? "text-warning"
                        : "text-warning"
                      : "text-muted"
                  }`}
                >
                  {r.driftPct >= 0 ? "+" : ""}
                  {r.driftPct.toFixed(1)}pp
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {drift.uncategorized.length > 0 ? (
        <div className="border-t border-border bg-bg/40 px-4 py-3 text-xs md:px-6">
          <div className="font-semibold text-muted">
            Uncategorized ({formatCurrency(
              drift.uncategorized.reduce((s, x) => s + x.marketValue, 0),
            )}
            {formatPercent(
              (drift.uncategorized.reduce((s, x) => s + x.marketValue, 0) /
                drift.totalMarketValue) *
                100,
            )}
            )
          </div>
          <div className="mt-1 text-muted">
            Map these to categories in the IPS editor below to include them in
            drift calculation:{" "}
            <span className="font-mono">
              {drift.uncategorized.map((u) => u.ticker).join(", ")}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
