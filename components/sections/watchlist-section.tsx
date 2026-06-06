import Link from "next/link";
import { TickerBadge } from "@/components/ticker-badge";
import { WatchlistIcon } from "@/components/icons";
import { listWatchlist } from "@/lib/portfolio/queries";
import { getQuotes } from "@/lib/marketdata";
import { formatCurrency, formatPercent } from "@/lib/format";

export async function WatchlistSection({ userId }: { userId: string }) {
  const items = await listWatchlist(userId);

  if (items.length === 0) {
    return (
      <div className="mx-auto mt-6 max-w-md rounded-card border border-dashed border-border bg-panel/40 p-12 text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-panel-2 text-muted">
          <WatchlistIcon className="h-6 w-6" />
        </div>
        <h2 className="text-[18px] font-semibold">No tickers watched yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Open any position page and tap the star to add a ticker. We&apos;ll track price and
          news for tickers you don&apos;t own yet.
        </p>
      </div>
    );
  }

  const quotes = await getQuotes(items.map((i) => i.ticker));

  return (
    <div className="rounded-card border border-border bg-panel">
      <div className="flex items-center justify-between px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">All watched</h2>
        <span className="text-sm text-muted">
          {items.length} ticker{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[1.8fr_1fr_1fr_0.8fr] gap-4 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
            <div>Ticker</div>
            <div className="text-right">Price</div>
            <div className="text-right">Day</div>
            <div className="text-right">Added</div>
          </div>

          {items.map((w) => {
            const q = quotes.get(w.ticker);
            const dayUp = (q?.changePct ?? 0) >= 0;
            return (
              <Link
                key={w.ticker}
                href={`/positions/${w.ticker}`}
                className="grid grid-cols-[1.8fr_1fr_1fr_0.8fr] items-center gap-4 border-t border-border px-4 py-4 transition-colors hover:bg-hover md:px-6"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <TickerBadge ticker={w.ticker} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{w.ticker}</div>
                    {w.note ? (
                      <div className="truncate text-xs text-muted">{w.note}</div>
                    ) : null}
                  </div>
                </div>
                <div className="text-right text-[14px] tabular-nums">
                  {q ? formatCurrency(q.price) : "—"}
                </div>
                <div
                  className={`text-right text-[14px] font-semibold tabular-nums ${
                    q == null ? "text-muted" : dayUp ? "text-success" : "text-danger"
                  }`}
                >
                  {q ? formatPercent(q.changePct) : "—"}
                </div>
                <div className="text-right text-[13px] text-muted">
                  {w.addedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
