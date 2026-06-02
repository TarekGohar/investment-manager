import { formatCurrency, formatPercent } from "@/lib/format";
import { Term } from "@/components/term";
import type { DividendForecastSummary } from "@/lib/portfolio/dividend-forecast";

export function DividendForecastCard({ summary }: { summary: DividendForecastSummary }) {
  if (summary.rows.length === 0 && summary.tickersWithoutData.length === 0) {
    return null;
  }

  const total = summary.totalProjectedGrossCad;
  const fwt = summary.totalProjectedFwtCad;
  const netAfterFwt = total - fwt;
  const shelteredPct = total > 0 ? (summary.shelteredCad / total) * 100 : 0;
  const taxablePct = total > 0 ? (summary.taxableCad / total) * 100 : 0;

  return (
    <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[16px] font-semibold">Forward 12-mo dividends</h3>
        <span className="text-xs text-muted">CAD-equivalent</span>
      </div>

      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="text-[26px] font-semibold leading-none tabular-nums">
          {formatCurrency(total)}
        </div>
        {fwt > 0 ? (
          <div className="text-xs text-muted">
            less <Term>FWT</Term> {formatCurrency(fwt)} · net{" "}
            <span className="font-semibold text-text">{formatCurrency(netAfterFwt)}</span>
          </div>
        ) : null}
      </div>

      {total > 0 ? (
        <>
          <div className="mb-3 flex h-2 w-full overflow-hidden rounded-full bg-pill">
            <div className="h-full bg-success" style={{ width: `${shelteredPct}%` }} title="Sheltered: in registered accounts (TFSA/RRSP/FHSA) — gains aren't taxed" />
            <div className="h-full bg-danger" style={{ width: `${taxablePct}%` }} title="Taxable: in a non-registered account — dividends count as income this year" />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-[8px] bg-bg/40 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-success">
                Sheltered
              </div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {formatCurrency(summary.shelteredCad)}
              </div>
              <div className="text-[10px] text-muted-2">
                {formatPercent(shelteredPct)} · tax-free / tax-deferred
              </div>
            </div>
            <div className="rounded-[8px] bg-bg/40 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-danger">
                Taxable
              </div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {formatCurrency(summary.taxableCad)}
              </div>
              <div className="text-[10px] text-muted-2">
                {formatPercent(taxablePct)} · non-reg income
              </div>
            </div>
          </div>
        </>
      ) : null}

      {summary.rows.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-[12px] font-semibold text-muted hover:text-text">
            Per-position breakdown
          </summary>
          <ul className="mt-2 space-y-1 text-[12px]">
            {summary.rows.map((r) => (
              <li
                key={r.ticker}
                className="flex items-baseline justify-between border-t border-border py-1.5 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <span className="font-mono font-semibold">{r.ticker}</span>
                  <span className="ml-2 text-[10px] uppercase text-muted-2">{r.currency}</span>
                  <span className="ml-2 text-[10px] text-muted-2">
                    {r.observedPaymentsTtm} obs / TTM
                  </span>
                </div>
                <div className="text-right tabular-nums">
                  <div>{formatCurrency(r.projectedGrossCad)}</div>
                  {r.projectedFwtCad > 0 ? (
                    <div className="text-[10px] text-warning">
                      − <Term>FWT</Term> {formatCurrency(r.projectedFwtCad)}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {summary.tickersWithoutData.length > 0 ? (
        <div className="mt-3 text-[11px] text-muted-2">
          No dividend history yet for: {summary.tickersWithoutData.join(", ")} —
          either no payments observed in the last 12 months or no data imported.
        </div>
      ) : null}
    </section>
  );
}
