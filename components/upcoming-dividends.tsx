import Link from "next/link";
import { TickerBadge } from "@/components/ticker-badge";
import { formatCurrency } from "@/lib/format";
import type { UpcomingDividend } from "@/lib/portfolio/dividend-calendar";

export function UpcomingDividends({ dividends }: { dividends: UpcomingDividend[] }) {
  if (dividends.length === 0) return null;

  const byMonth = new Map<string, UpcomingDividend[]>();
  for (const d of dividends) {
    const key = monthKey(d.payDate);
    const arr = byMonth.get(key) ?? [];
    arr.push(d);
    byMonth.set(key, arr);
  }

  const totalCad = dividends.reduce((s, d) => s + d.estimatedAmountCad, 0);

  return (
    <div className="rounded-card border border-border bg-panel">
      <div className="flex items-baseline justify-between px-4 py-5 md:px-6">
        <div>
          <h2 className="text-[16px] font-semibold">Upcoming dividends</h2>
          <p className="mt-1 text-xs text-muted-2">
            Next ~3 months · pay-dates from Yahoo where confirmed, else projected from cadence
          </p>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-semibold tabular-nums">~{formatCurrency(totalCad)}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">CAD est</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {Array.from(byMonth.entries()).map(([month, items]) => {
            const monthCad = items.reduce((s, d) => s + d.estimatedAmountCad, 0);
            return (
              <div key={month}>
                <div className="flex items-center justify-between border-t border-border bg-bg/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
                  <span>{month}</span>
                  <span className="tabular-nums text-muted-2">{formatCurrency(monthCad)} CAD</span>
                </div>
                {items.map((d) => (
                  <Link
                    key={d.ticker + d.payDate.toISOString()}
                    href={`/positions/${d.ticker}`}
                    className="grid grid-cols-[1.4fr_0.9fr_0.9fr_1fr] items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-hover md:px-6"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <TickerBadge ticker={d.ticker} />
                      <span className="truncate text-[14px] font-semibold">{d.ticker}</span>
                    </div>
                    <div className="text-sm text-muted tabular-nums">
                      {d.exDate ? <>Ex {formatShortDate(d.exDate)}</> : <span className="text-muted-2">Ex —</span>}
                    </div>
                    <div className="text-sm tabular-nums">
                      Pay {formatShortDate(d.payDate)}
                      {d.isProjected ? (
                        <span className="ml-1 rounded bg-pill px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-2">
                          est
                        </span>
                      ) : null}
                    </div>
                    <div className="text-right text-[14px] font-semibold tabular-nums">
                      ~{formatCurrency(d.estimatedAmount)}
                      <span className="ml-1 text-[10px] font-semibold uppercase text-muted-2">
                        {d.currency}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function monthKey(d: Date): string {
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
