import Link from "next/link";
import { TickerBadge } from "@/components/ticker-badge";
import { formatCurrency, formatPercent, formatQty } from "@/lib/format";
import type { TlhCandidate } from "@/lib/canadian/tlh";

export function TlhCandidates({
  candidates,
  hasMarginalRate,
}: {
  candidates: TlhCandidate[];
  hasMarginalRate: boolean;
}) {
  if (candidates.length === 0) {
    return (
      <section className="rounded-card border border-border bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
          <h2 className="text-[16px] font-semibold">Tax-loss harvest</h2>
          <span className="text-xs text-muted">Nothing to harvest</span>
        </div>
        <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
          No non-registered positions with meaningful unrealized losses right now.
        </div>
      </section>
    );
  }

  const totalSaving = candidates.reduce(
    (s, c) => s + (c.estimatedTaxSaving ?? 0),
    0,
  );
  const totalLoss = candidates.reduce((s, c) => s + Math.abs(c.unrealizedLoss), 0);

  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Tax-loss harvest candidates</h2>
        <span className="text-xs text-muted">
          {candidates.length} position{candidates.length === 1 ? "" : "s"}
          {hasMarginalRate ? (
            <>
              {" "}· ~
              <span className="font-semibold text-success">
                {formatCurrency(totalSaving)}
              </span>{" "}
              potential tax saved at your marginal rate
            </>
          ) : null}
        </span>
      </div>

      {!hasMarginalRate ? (
        <div className="border-t border-border bg-warning/5 px-4 py-3 text-xs text-warning md:px-6">
          Dollar savings are hidden until you set your marginal capital-gains
          rate in{" "}
          <Link href="/settings" className="underline">
            Settings → Tax profile
          </Link>
          . No bracket is assumed.
        </div>
      ) : null}

      <div className="divide-y divide-border">
        {candidates.map((c) => {
          const lossPct = c.acb > 0 ? ((c.currentPrice - c.acb) / c.acb) * 100 : 0;
          return (
            <div key={c.ticker} className="px-4 py-4 md:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Link
                  href={`/positions/${c.ticker}`}
                  className="flex min-w-0 items-center gap-3 hover:underline"
                >
                  <TickerBadge ticker={c.ticker} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{c.ticker}</div>
                    <div className="text-xs text-muted">
                      {formatQty(c.nonRegQuantity)} sh @ ACB {formatCurrency(c.acb)} · now{" "}
                      {formatCurrency(c.currentPrice)} ({formatPercent(lossPct)})
                    </div>
                  </div>
                </Link>
                <div className="text-right">
                  <div className="text-[15px] font-semibold tabular-nums text-danger">
                    {formatCurrency(c.unrealizedLoss)}
                  </div>
                  {c.estimatedTaxSaving != null ? (
                    <div className="text-xs text-success">
                      ~{formatCurrency(c.estimatedTaxSaving)} saved
                    </div>
                  ) : (
                    <div className="text-xs text-muted-2">saving — set rate</div>
                  )}
                </div>
              </div>

              {c.replacements.length > 0 ? (
                <div className="mt-3 rounded-[10px] border border-border bg-bg/40 p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Replacement options{" "}
                    <span className="text-muted-2">(buy immediately, no 31-day wait)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.replacements.slice(0, 6).map((r) => (
                      <span
                        key={r.ticker}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-panel px-2.5 py-1 text-[12px]"
                        title={r.riskNote ?? r.label}
                      >
                        <span className="font-mono font-semibold">{r.ticker}</span>
                        <span className="text-muted-2">·</span>
                        <span className="text-muted">{r.label}</span>
                      </span>
                    ))}
                  </div>
                  {c.replacements.some((r) => r.riskNote) ? (
                    <p className="mt-2 text-xs text-muted-2">
                      {c.replacements.find((r) => r.riskNote)!.riskNote}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 rounded-[10px] border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                  No curated replacement found. To harvest, wait 31 days before
                  buying {c.ticker} back.
                </div>
              )}

              <div className="mt-2 text-xs text-muted-2">
                {c.hasActiveWindow ? (
                  <span className="text-warning">
                    ⚠ Active 30-day window already open from a prior loss sale.
                  </span>
                ) : (
                  <>
                    Earliest safe same-ticker buyback:{" "}
                    {c.earliestBuybackDate.toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border px-4 py-3 text-xs text-muted-2 md:px-6">
        Total unrealized loss: {formatCurrency(totalLoss)}.
        {hasMarginalRate
          ? " Saving estimates use the marginal capital-gains rate you set in Settings."
          : null}
      </div>
    </section>
  );
}
