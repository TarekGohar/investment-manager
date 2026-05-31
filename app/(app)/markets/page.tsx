import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { TickerBadge } from "@/components/ticker-badge";
import { AllocationDonut } from "@/components/allocation-donut";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "@/components/icons";
import { auth } from "@/lib/auth";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { getFundamentals, getQuote } from "@/lib/marketdata";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";

const INDEX_TICKERS = ["SPY", "QQQ", "DIA", "IWM", "VTI"] as const;
const INDEX_NAMES: Record<(typeof INDEX_TICKERS)[number], string> = {
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
  DIA: "Dow Jones",
  IWM: "Russell 2000",
  VTI: "Total US Market",
};

export default async function MarketsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const portfolio = await getEnrichedPortfolio(session.user.id);
  const heldTickers = portfolio.holdings.map((h) => h.ticker);

  const [indexQuotes, holdingsFundamentals] = await Promise.all([
    Promise.all(INDEX_TICKERS.map((t) => getQuote(t))),
    Promise.all(heldTickers.map((t) => getFundamentals(t))),
  ]);

  // ─── Sector breakdown ────────────────────────────────────────────
  const sectorTotals = new Map<string, number>();
  for (let i = 0; i < portfolio.holdings.length; i++) {
    const h = portfolio.holdings[i];
    const fund = holdingsFundamentals[i];
    const sector = fund?.industry?.trim() || "Unclassified";
    const value = h.marketValue ?? h.costBasis;
    sectorTotals.set(sector, (sectorTotals.get(sector) ?? 0) + value);
  }
  const sectorItems = Array.from(sectorTotals.entries()).map(([sector, value]) => ({
    ticker: sector,
    value,
  }));

  // ─── Top movers ─────────────────────────────────────────────────
  const movers = portfolio.holdings
    .filter((h) => h.dayChangePct != null)
    .sort((a, b) => Math.abs((b.dayChangePct ?? 0)) - Math.abs((a.dayChangePct ?? 0)))
    .slice(0, 8);

  const hasIndexData = indexQuotes.some((q) => q != null);

  return (
    <>
      <Topbar title="Markets" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        {/* Indices */}
        <section className="mb-[26px]">
          <h2 className="mb-4 text-[16px] font-semibold">US indices</h2>
          {hasIndexData ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {INDEX_TICKERS.map((ticker, i) => (
                <IndexCard
                  key={ticker}
                  ticker={ticker}
                  name={INDEX_NAMES[ticker]}
                  quote={indexQuotes[i]}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-card border border-dashed border-border bg-panel/40 px-6 py-8 text-center text-sm text-muted">
              Couldn&apos;t fetch index quotes right now. Check back shortly.
            </div>
          )}
        </section>

        {/* Two-column on lg, stacked on mobile */}
        <div className="flex flex-col gap-[26px] lg:flex-row lg:items-start">
          {/* Top movers */}
          <section className="min-w-0 flex-1 rounded-card border border-border bg-panel">
            <div className="flex items-center justify-between px-4 py-5 md:px-6">
              <h2 className="text-[16px] font-semibold">Top movers in your book</h2>
              <span className="text-xs text-muted">Day change</span>
            </div>
            {movers.length === 0 ? (
              <div className="border-t border-border px-6 py-10 text-center text-sm text-muted">
                {portfolio.holdings.length === 0
                  ? "Record your first transaction to see movers here."
                  : "Live quotes unavailable for your holdings right now."}
              </div>
            ) : (
              movers.map((h) => {
                const up = (h.dayChangePct ?? 0) >= 0;
                return (
                  <Link
                    key={h.ticker}
                    href={`/positions/${h.ticker}`}
                    className="flex items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-hover md:px-6"
                  >
                    <TickerBadge ticker={h.ticker} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{h.ticker}</div>
                      <div className="text-xs text-muted">
                        {h.marketPrice != null ? formatCurrency(h.marketPrice) : "—"}
                      </div>
                    </div>
                    <div
                      className={`flex items-center gap-1 text-right text-[14px] font-semibold tabular-nums ${
                        up ? "text-success" : "text-danger"
                      }`}
                    >
                      {up ? (
                        <ArrowUpRightIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRightIcon className="h-3.5 w-3.5" />
                      )}
                      {formatPercent(h.dayChangePct ?? 0)}
                    </div>
                    <div
                      className={`hidden w-[110px] text-right text-[13px] tabular-nums sm:block ${
                        up ? "text-success" : "text-danger"
                      }`}
                    >
                      {h.dayChange != null ? formatSignedCurrency(h.dayChange) : "—"}
                    </div>
                  </Link>
                );
              })
            )}
          </section>

          {/* Sector exposure */}
          <div className="w-full lg:w-[420px] lg:shrink-0">
            {sectorItems.length > 0 ? (
              <AllocationDonut
                items={sectorItems}
                title="Sector exposure"
                subtitle={portfolio.hasAnyQuote ? "By market value" : "By cost basis"}
              />
            ) : (
              <section className="mb-[26px] rounded-card border border-dashed border-border bg-panel/40 p-6 text-center text-sm text-muted">
                Add transactions and load a few position pages — sector data is cached as you
                browse and will appear here once available.
              </section>
            )}
          </div>
        </div>

        <p className="mt-2 text-xs text-muted-2">
          Quotes from Finnhub (15-min delayed). Indices are tracked via their major ETF proxies.
        </p>
      </div>
    </>
  );
}

function IndexCard({
  ticker,
  name,
  quote,
}: {
  ticker: string;
  name: string;
  quote: Awaited<ReturnType<typeof getQuote>>;
}) {
  if (!quote) {
    return (
      <Link
        href={`/positions/${ticker}`}
        className="rounded-card border border-border bg-panel p-4 transition-colors hover:bg-panel-2"
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{ticker}</div>
        <div className="mt-1 text-[15px] font-semibold">{name}</div>
        <div className="mt-3 text-sm text-muted">No quote</div>
      </Link>
    );
  }

  const up = quote.changePct >= 0;
  return (
    <Link
      href={`/positions/${ticker}`}
      className="rounded-card border border-border bg-panel p-4 transition-colors hover:bg-panel-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{ticker}</div>
        <div
          className={`flex items-center gap-1 text-[12px] font-semibold tabular-nums ${
            up ? "text-success" : "text-danger"
          }`}
        >
          {up ? (
            <ArrowUpRightIcon className="h-3 w-3" />
          ) : (
            <ArrowDownRightIcon className="h-3 w-3" />
          )}
          {formatPercent(quote.changePct)}
        </div>
      </div>
      <div className="mt-1 truncate text-[15px] font-semibold">{name}</div>
      <div className="mt-3 text-[20px] font-semibold tabular-nums">
        {formatCurrency(quote.price)}
      </div>
      <div
        className={`text-xs font-medium tabular-nums ${
          up ? "text-success" : "text-danger"
        }`}
      >
        {formatSignedCurrency(quote.change)} today
      </div>
    </Link>
  );
}
