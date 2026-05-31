import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { TickerBadge } from "@/components/ticker-badge";
import { PortfolioIcon, PlusIcon } from "@/components/icons";
import { auth } from "@/lib/auth";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { formatCurrency, formatPercent, formatQty, formatSignedCurrency } from "@/lib/format";

export default async function PortfolioPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const portfolio = await getEnrichedPortfolio(session.user.id);

  if (portfolio.holdings.length === 0) {
    return (
      <>
        <Topbar title="Portfolio" />
        <div className="px-[34px] pb-[60px] pt-[30px]">
          <div className="mx-auto mt-12 max-w-md rounded-card border border-dashed border-border bg-panel/40 p-12 text-center">
            <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-panel-2 text-muted">
              <PortfolioIcon className="h-6 w-6" />
            </div>
            <h2 className="text-[18px] font-semibold">No holdings yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              Once you record your first buy, this view will show all your positions with live
              prices, cost basis, realized gains, and dividends.
            </p>
            <Link
              href="/transactions"
              className="mt-6 inline-flex items-center gap-2 rounded-[28px] bg-gradient-to-r from-brand to-brand-3 px-6 py-3 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
            >
              <PlusIcon className="h-4 w-4" />
              Record transaction
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Portfolio" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label={portfolio.hasAnyQuote ? "Market value" : "Cost basis"}
            value={formatCurrency(
              portfolio.hasAnyQuote ? portfolio.totalMarketValue : portfolio.totalCost,
            )}
          />
          <Stat
            label="Unrealized"
            value={portfolio.hasAnyQuote ? formatSignedCurrency(portfolio.totalUnrealized) : "—"}
            secondary={portfolio.hasAnyQuote ? formatPercent(portfolio.totalUnrealizedPct) : undefined}
            tone={portfolio.hasAnyQuote ? (portfolio.totalUnrealized >= 0 ? "up" : "down") : undefined}
          />
          <Stat
            label="Realized P&L"
            value={formatSignedCurrency(portfolio.totalRealized)}
            tone={portfolio.totalRealized === 0 ? undefined : portfolio.totalRealized > 0 ? "up" : "down"}
          />
          <Stat
            label="Dividends received"
            value={formatCurrency(portfolio.totalDividends)}
          />
        </div>

        <div className="rounded-card border border-border bg-panel">
          <div className="flex items-center justify-between px-4 py-5 md:px-6">
            <h2 className="text-[16px] font-semibold">All holdings</h2>
            <span className="text-sm text-muted">{portfolio.holdings.length} positions</span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
          <div className="grid grid-cols-[1.7fr_0.55fr_0.85fr_0.85fr_0.7fr_0.85fr_0.95fr_0.55fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
            <div>Position</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Avg cost</div>
            <div className="text-right">Price</div>
            <div className="text-right">Day</div>
            <div className="text-right">Value</div>
            <div className="text-right">Unrealized</div>
            <div className="text-right">Wt</div>
          </div>

          {portfolio.holdings.map((h) => {
            const refValue = h.marketValue ?? h.costBasis;
            const denom = portfolio.hasAnyQuote ? portfolio.totalMarketValue : portfolio.totalCost;
            const weight = denom > 0 ? (refValue / denom) * 100 : 0;
            const dayUp = (h.dayChangePct ?? 0) >= 0;
            const unrealizedUp = (h.unrealized ?? 0) >= 0;
            return (
              <Link
                key={h.ticker}
                href={`/positions/${h.ticker}`}
                className="grid grid-cols-[1.7fr_0.55fr_0.85fr_0.85fr_0.7fr_0.85fr_0.95fr_0.55fr] items-center gap-3 border-t border-border px-4 py-4 transition-colors hover:bg-hover md:px-6"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <TickerBadge ticker={h.ticker} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{h.ticker}</div>
                    <div className="truncate text-xs text-muted">
                      Opened {h.openedAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </div>
                  </div>
                </div>
                <div className="text-right text-[14px] tabular-nums">{formatQty(h.quantity)}</div>
                <div className="text-right text-[14px] tabular-nums">{formatCurrency(h.avgCost)}</div>
                <div className="text-right text-[14px] tabular-nums">
                  {h.marketPrice != null ? formatCurrency(h.marketPrice) : "—"}
                </div>
                <div
                  className={`text-right text-[14px] font-semibold tabular-nums ${
                    h.dayChangePct == null ? "text-muted" : dayUp ? "text-success" : "text-danger"
                  }`}
                >
                  {h.dayChangePct != null ? formatPercent(h.dayChangePct) : "—"}
                </div>
                <div className="text-right text-[14px] font-semibold tabular-nums">
                  {formatCurrency(refValue)}
                </div>
                <div
                  className={`text-right text-[14px] font-semibold tabular-nums ${
                    h.unrealized == null
                      ? "text-muted"
                      : unrealizedUp
                        ? "text-success"
                        : "text-danger"
                  }`}
                >
                  {h.unrealized != null ? formatSignedCurrency(h.unrealized) : "—"}
                </div>
                <div className="text-right text-[14px] text-muted tabular-nums">
                  {weight.toFixed(1)}%
                </div>
              </Link>
            );
          })}
            </div>
          </div>
        </div>

        {portfolio.quoteAsOf ? (
          <p className="mt-4 text-xs text-muted-2">
            Prices as of {portfolio.quoteAsOf.toLocaleString()} · Finnhub (15-min delayed)
          </p>
        ) : null}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  secondary,
  tone,
}: {
  label: string;
  value: string;
  secondary?: string;
  tone?: "up" | "down";
}) {
  const color = tone === "up" ? "text-success" : tone === "down" ? "text-danger" : "text-text";
  return (
    <div className="rounded-card border border-border bg-panel px-5 py-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold tabular-nums ${color}`}>{value}</div>
      {secondary ? (
        <div className={`text-xs font-medium tabular-nums ${color}`}>{secondary}</div>
      ) : null}
    </div>
  );
}
