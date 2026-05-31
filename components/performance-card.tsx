import Link from "next/link";
import { formatPercent, formatSignedCurrency } from "@/lib/format";
import type { PerformanceSummary } from "@/lib/portfolio/performance-summary";

export function PerformanceCard({ summary }: { summary: PerformanceSummary }) {
  const empty = summary.snapshotCount < 2;
  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Performance</h2>
        <span className="text-xs text-muted">
          {summary.snapshotCount} snapshot{summary.snapshotCount === 1 ? "" : "s"}
          {summary.firstSnapshotDate
            ? ` · since ${summary.firstSnapshotDate.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`
            : ""}
        </span>
      </div>

      {empty ? (
        <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
          Need at least 2 daily NAV snapshots to compute performance. The
          end-of-day cron writes one per trading day; you can also backfill
          from historical candles via the API.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 border-t border-border px-4 py-4 md:grid-cols-4 md:px-6">
            <Metric
              label="TWR (period)"
              value={summary.twr != null ? formatPercent(summary.twr * 100) : "—"}
              tone={summary.twr == null ? undefined : summary.twr >= 0 ? "up" : "down"}
            />
            <Metric
              label="TWR annualized"
              value={
                summary.twrAnnualized != null
                  ? formatPercent(summary.twrAnnualized * 100)
                  : "—"
              }
              tone={
                summary.twrAnnualized == null
                  ? undefined
                  : summary.twrAnnualized >= 0
                    ? "up"
                    : "down"
              }
            />
            <Metric
              label="IRR (annualized)"
              value={summary.irr != null ? formatPercent(summary.irr * 100) : "—"}
              tone={summary.irr == null ? undefined : summary.irr >= 0 ? "up" : "down"}
            />
            <Metric
              label="Max drawdown"
              value={
                summary.maxDrawdown
                  ? formatPercent(summary.maxDrawdown.drawdown * 100)
                  : "—"
              }
              tone={summary.maxDrawdown ? "down" : undefined}
              hint={
                summary.maxDrawdown
                  ? `${summary.maxDrawdown.peakDate.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} → ${summary.maxDrawdown.troughDate.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
                  : undefined
              }
            />
            <Metric
              label={
                summary.benchmarkTicker
                  ? `Beta vs ${summary.benchmarkTicker}`
                  : "Beta"
              }
              value={
                summary.beta != null
                  ? summary.beta.toFixed(2)
                  : summary.benchmarkTicker
                    ? "—"
                    : "set benchmark"
              }
              tone={undefined}
            />
            <Metric
              label="Sharpe ratio"
              value={
                summary.sharpe != null
                  ? summary.sharpe.toFixed(2)
                  : "set rfr"
              }
              hint={
                summary.riskFreeRate != null
                  ? `rfr ${(summary.riskFreeRate * 100).toFixed(2)}%`
                  : undefined
              }
            />
            <Metric
              label={
                summary.benchmarkTicker
                  ? `${summary.benchmarkTicker} TWR annualized`
                  : "Benchmark TWR"
              }
              value={
                summary.twrBenchmarkAnnualized != null
                  ? formatPercent(summary.twrBenchmarkAnnualized * 100)
                  : summary.benchmarkTicker
                    ? "—"
                    : "set benchmark"
              }
            />
            <Metric
              label="Alpha (annualized)"
              value={
                summary.twrAlphaAnnualized != null
                  ? formatSignedPct(summary.twrAlphaAnnualized * 100)
                  : "—"
              }
              tone={
                summary.twrAlphaAnnualized == null
                  ? undefined
                  : summary.twrAlphaAnnualized >= 0
                    ? "up"
                    : "down"
              }
            />
          </div>

          {(!summary.benchmarkTicker || summary.riskFreeRate == null) && (
            <div className="border-t border-border bg-warning/5 px-4 py-3 text-xs text-warning md:px-6">
              {!summary.benchmarkTicker
                ? "No benchmark ticker set — beta and benchmark-relative TWR are hidden. "
                : ""}
              {summary.riskFreeRate == null
                ? "No risk-free rate set — Sharpe is hidden. "
                : ""}
              Edit in{" "}
              <Link href="/settings" className="underline">
                Settings → Performance profile
              </Link>
              .
            </div>
          )}

          {summary.equityCurve.length > 0 ? (
            <div className="border-t border-border px-4 py-5 md:px-6">
              <EquityCurve curve={summary.equityCurve} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function formatSignedPct(pct: number): string {
  const s = formatPercent(Math.abs(pct));
  return pct >= 0 ? `+${s}` : `-${s}`;
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-success"
      : tone === "down"
        ? "text-danger"
        : "text-text";
  return (
    <div className="rounded-[10px] bg-bg/40 px-3 py-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-[18px] font-semibold tabular-nums ${color}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-muted-2">{hint}</div> : null}
    </div>
  );
}

function EquityCurve({
  curve,
}: {
  curve: Array<{ date: string; portfolio: number; benchmark: number | null }>;
}) {
  if (curve.length < 2) return null;
  const width = 720;
  const height = 160;
  const padding = { top: 10, right: 8, bottom: 18, left: 8 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const allValues: number[] = [];
  for (const p of curve) {
    allValues.push(p.portfolio);
    if (p.benchmark != null) allValues.push(p.benchmark);
  }
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const x = (i: number) => padding.left + (i * w) / (curve.length - 1);
  const y = (v: number) => padding.top + h - ((v - min) / range) * h;

  const pPath = curve
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.portfolio).toFixed(1)}`)
    .join(" ");
  const bPoints = curve
    .map((p, i) =>
      p.benchmark == null
        ? null
        : `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.benchmark).toFixed(1)}`,
    )
    .filter(Boolean) as string[];
  const bPath = bPoints.join(" ");

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted">
        <Legend color="var(--color-brand)" label="Portfolio" />
        {bPath ? <Legend color="var(--color-muted-2)" label="Benchmark" /> : null}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        {bPath ? (
          <path
            d={bPath}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1.5"
            className="text-muted"
          />
        ) : null}
        <path
          d={pPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-brand"
        />
      </svg>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-[2px] w-4 rounded" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}
