import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { TickerBadge } from "@/components/ticker-badge";
import { LocationBadge } from "@/components/location-badge";
import { PortfolioIcon, PlusIcon } from "@/components/icons";
import { auth } from "@/lib/auth";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { analyzePortfolioLocation } from "@/lib/canadian/location";
import { getCorrelationMatrix } from "@/lib/portfolio/performance-summary";
import { CorrelationHeatmap } from "@/components/correlation-heatmap";
import { getCashBalances, summarizeCash } from "@/lib/portfolio/cash";
import { CashBalances } from "@/components/cash-balances";
import { findMissingPositions } from "@/lib/portfolio/missing-positions";
import { MissingPositionsCard } from "@/components/missing-positions-card";
import { PortfolioByAccount } from "@/components/portfolio-by-account";
import { NetWorthCard } from "@/components/net-worth-card";
import { Term } from "@/components/term";
import { getFxRateToCad } from "@/lib/marketdata/fx";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatPercent, formatQty, formatSignedCurrency } from "@/lib/format";

export default async function PortfolioPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const portfolio = await getEnrichedPortfolio(session.user.id);
  const [locationOverview, correlation, cashBalances, missingPositions, brokerages] = await Promise.all([
    portfolio.holdings.length > 0
      ? analyzePortfolioLocation(portfolio.holdings)
      : Promise.resolve(null),
    portfolio.holdings.length > 1
      ? getCorrelationMatrix(session.user.id)
      : Promise.resolve(null),
    getCashBalances(session.user.id),
    findMissingPositions(session.user.id),
    prisma.brokerage.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true, kind: true },
    }),
  ]);
  const cashSummary = summarizeCash(cashBalances);
  const brokerageInfo = brokerages.map((b) => ({
    brokerageId: b.id,
    brokerageName: b.name,
    brokerageKind: b.kind,
  }));

  // CAD-convert cash totals so the net-worth card sums apples-to-apples
  // with the asset totals. One FX call (cached) covers everything.
  const cashCurrencies = Object.keys(cashSummary.totalsByCurrency);
  const needsUsdToCad = cashCurrencies.includes("USD");
  const usdToCadRate = needsUsdToCad
    ? ((await getFxRateToCad("USD", new Date()))?.rate ?? null)
    : null;
  let cashCad = 0;
  for (const [ccy, amount] of Object.entries(cashSummary.totalsByCurrency)) {
    if (ccy === "CAD") cashCad += amount;
    else if (ccy === "USD" && usdToCadRate) cashCad += amount * usdToCadRate;
    else cashCad += amount; // fallback for currencies we haven't wired
  }

  if (portfolio.holdings.length === 0) {
    return (
      <>
        <Topbar title="Portfolio" />
        <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
          {cashCad > 0.005 ? (
            <NetWorthCard
              assetsCad={0}
              cashCad={cashCad}
              cashByCurrency={cashSummary.totalsByCurrency}
            />
          ) : null}
          <MissingPositionsCard positions={missingPositions} />
          <div className="mx-auto mt-12 max-w-md rounded-card border border-dashed border-border bg-panel/40 p-12 text-center">
            <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-panel-2 text-muted">
              <PortfolioIcon className="h-6 w-6" />
            </div>
            <h2 className="text-[18px] font-semibold">
              {missingPositions.length > 0 ? "No active positions" : "No holdings yet"}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              {missingPositions.length > 0
                ? "Record opening balances for the positions above and they'll appear here."
                : "Once you record your first buy, this view will show all your positions with live prices, cost basis, realized gains, and dividends."}
            </p>
            {missingPositions.length === 0 ? (
              <Link
                href="/transactions"
                className="mt-6 inline-flex items-center gap-2 rounded-[28px] bg-gradient-to-r from-brand to-brand-3 px-6 py-3 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
              >
                <PlusIcon className="h-4 w-4" />
                Record transaction
              </Link>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Portfolio" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <NetWorthCard
          assetsCad={portfolio.totalMarketValue}
          cashCad={cashCad}
          cashByCurrency={cashSummary.totalsByCurrency}
        />

        <MissingPositionsCard positions={missingPositions} />

        <div className="mb-2 text-xs text-muted-2">All totals below are in CAD-equivalent (today&apos;s BoC rate).</div>
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label={portfolio.hasAnyQuote ? "Market value (CAD)" : <><Term>Cost basis</Term> (CAD)</>}
            value={formatCurrency(
              portfolio.hasAnyQuote ? portfolio.totalMarketValue : portfolio.totalCost,
            )}
          />
          <Stat
            label={<><Term>Unrealized</Term> (CAD)</>}
            value={portfolio.hasAnyQuote ? formatSignedCurrency(portfolio.totalUnrealized) : "—"}
            secondary={portfolio.hasAnyQuote ? formatPercent(portfolio.totalUnrealizedPct) : undefined}
            tone={portfolio.hasAnyQuote ? (portfolio.totalUnrealized >= 0 ? "up" : "down") : undefined}
          />
          <Stat
            label={<><Term term="Realized P&L">Realized P&amp;L</Term> (CAD)</>}
            value={formatSignedCurrency(portfolio.totalRealized)}
            tone={portfolio.totalRealized === 0 ? undefined : portfolio.totalRealized > 0 ? "up" : "down"}
          />
          <Stat
            label="Dividends (CAD)"
            value={formatCurrency(portfolio.totalDividends)}
          />
        </div>

        <div className="rounded-card border border-border bg-panel">
          <div className="flex items-center justify-between px-4 py-5 md:px-6">
            <h2 className="text-[16px] font-semibold">All holdings</h2>
            <span className="text-sm text-muted">{portfolio.holdings.length} positions</span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
          <div className="grid grid-cols-[1.6fr_0.55fr_0.8fr_0.8fr_0.6fr_0.8fr_0.9fr_0.7fr_0.5fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
            <div>Position</div>
            <div className="text-right">Qty</div>
            <div className="text-right"><Term>Cost/sh</Term></div>
            <div className="text-right">Price</div>
            <div className="text-right">Day</div>
            <div className="text-right">Value</div>
            <div className="text-right"><Term>Unrealized</Term></div>
            <div className="text-right">Location</div>
            <div className="text-right">Wt</div>
          </div>

          {portfolio.holdings.map((h) => {
            // Weight: always CAD-on-CAD so cross-currency positions compare
            // fairly. The displayed Value column stays in the position's
            // native currency.
            const refValueCad = h.marketValueCad ?? h.costBasisCad;
            const denomCad = portfolio.hasAnyQuote
              ? portfolio.totalMarketValue
              : portfolio.totalCost;
            const weight = denomCad > 0 ? (refValueCad / denomCad) * 100 : 0;
            const refValueNative = h.marketValue ?? h.costBasis;
            const dayUp = (h.dayChangePct ?? 0) >= 0;
            const unrealizedUp = (h.unrealized ?? 0) >= 0;
            const locScore = locationOverview?.byTicker.get(h.ticker)?.worstScore;
            return (
              <Link
                key={h.ticker}
                href={`/positions/${h.ticker}`}
                className="grid grid-cols-[1.6fr_0.55fr_0.8fr_0.8fr_0.6fr_0.8fr_0.9fr_0.7fr_0.5fr] items-center gap-3 border-t border-border px-4 py-4 transition-colors hover:bg-hover md:px-6"
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
                <div className="text-right text-[14px] tabular-nums">
                  {formatCurrency(h.quantity > 0 ? h.costBasis / h.quantity : 0)}
                  <span className="ml-1 text-[10px] font-semibold uppercase text-muted-2">
                    {h.currency}
                  </span>
                </div>
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
                  {formatCurrency(refValueNative)}
                  <span className="ml-1 text-[10px] font-semibold uppercase text-muted-2">
                    {h.currency}
                  </span>
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
                <div className="flex justify-end">
                  {locScore ? <LocationBadge score={locScore} size="sm" /> : null}
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

        {portfolio.holdings.length > 0 ? (
          <div className="mt-[26px]">
            <PortfolioByAccount portfolio={portfolio} brokerages={brokerageInfo} />
          </div>
        ) : null}

        <div className="mt-[26px]">
          <CashBalances summary={cashSummary} />
        </div>

        {correlation ? (
          <div className="mt-[26px]">
            <CorrelationHeatmap data={correlation} />
          </div>
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
  label: React.ReactNode;
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
