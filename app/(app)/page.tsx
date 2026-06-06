import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PriceChart } from "@/components/charts/price-chart";
import { TickerBadge } from "@/components/ticker-badge";
import { AllocationDonut } from "@/components/allocation-donut";
import { PMReadCard } from "@/components/pm-read-card";
import { PerformanceCard } from "@/components/performance-card";
import { OpenRecommendationsCard } from "@/components/open-recommendations-card";
import { CurrencyExposureCard } from "@/components/currency-exposure-card";
import { DividendForecastCard } from "@/components/dividend-forecast-card";
import { AttributionCard } from "@/components/attribution-card";
import { getLatestAnalysis } from "@/lib/ai/reviews";
import { listOpenRecommendations } from "@/lib/coaching/queries";
import { computeCurrencyExposure } from "@/lib/portfolio/currency-exposure";
import { computeDividendForecast } from "@/lib/portfolio/dividend-forecast";
import { computeAttribution } from "@/lib/portfolio/attribution";
import { getCashBalances, summarizeCash } from "@/lib/portfolio/cash";
import { getFxRateToCad } from "@/lib/marketdata/fx";
import { getPerformanceSummary } from "@/lib/portfolio/performance-summary";
import { analyzePortfolioLocation } from "@/lib/canadian/location";
import { LocationBadge } from "@/components/location-badge";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  PlusIcon,
  TransactionsIcon,
} from "@/components/icons";
import { auth } from "@/lib/auth";
import { Term } from "@/components/term";
import { getEnrichedPortfolio, listTransactions } from "@/lib/portfolio/queries";
import { investedCapitalSeries } from "@/lib/portfolio/holdings";
import { getUserPreferences } from "@/lib/preferences";
import {
  formatCurrency,
  formatPercent,
  formatQty,
  formatSignedCurrency,
} from "@/lib/format";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [portfolio, latestReview, preferences, openRecs, cashBalances] = await Promise.all([
    getEnrichedPortfolio(session.user.id),
    getLatestAnalysis(session.user.id, "WEEKLY"),
    getUserPreferences(session.user.id),
    listOpenRecommendations(session.user.id),
    getCashBalances(session.user.id),
  ]);
  const cashSummary = summarizeCash(cashBalances);

  const performance =
    portfolio.holdings.length > 0
      ? await getPerformanceSummary(session.user.id, preferences.performanceProfile)
      : null;

  const locationOverview =
    portfolio.holdings.length > 0
      ? await analyzePortfolioLocation(portfolio.holdings)
      : null;

  if (portfolio.holdings.length === 0) {
    return (
      <>
        <Topbar title="Home" />
        <div className="px-[34px] pb-[60px] pt-[30px]">
          <EmptyDashboard />
        </div>
      </>
    );
  }

  const transactions = await listTransactions(session.user.id);
  const series = investedCapitalSeries([...transactions].reverse());

  // Session 6 forecasting cards — one shared FX fetch covers all three.
  const hasNonCadHolding = portfolio.holdings.some((h) => h.currency !== "CAD");
  const hasNonCadCash = Object.keys(cashSummary.totalsByCurrency).some(
    (c) => c !== "CAD",
  );
  const usdToCadRate =
    hasNonCadHolding || hasNonCadCash
      ? ((await getFxRateToCad("USD", new Date()))?.rate ?? null)
      : null;
  const currencyExposure = computeCurrencyExposure({
    portfolio,
    cash: cashSummary,
    usdToCadRate,
  });
  const dividendForecast = computeDividendForecast({
    portfolio,
    transactions,
    usdToCadRate,
  });
  const attribution = computeAttribution({ portfolio });

  const dayUp = portfolio.totalDayChange >= 0;
  const totalUp = portfolio.totalUnrealized >= 0;
  const heroValue = portfolio.hasAnyQuote ? portfolio.totalMarketValue : portfolio.totalCost;
  const heroLabel = portfolio.hasAnyQuote ? "Total portfolio value" : "Total invested";

  return (
    <>
      <Topbar title="Home" />
      <div className="flex flex-col gap-6 px-4 pb-12 pt-6 md:px-6 lg:flex-row lg:items-start lg:gap-[34px] lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        {/* Main */}
        <section className="min-w-0 lg:flex-1">
          {openRecs.length > 0 ? <OpenRecommendationsCard items={openRecs} /> : null}
          {/* Hero */}
          <div className="mb-[18px]">
            <div className="mb-[6px] text-[13px] font-medium text-muted">{heroLabel}</div>
            <div className="text-[32px] font-semibold leading-none tracking-[-0.5px] tabular-nums md:text-[42px]">
              {formatCurrency(heroValue)}
            </div>
            {portfolio.hasAnyQuote ? (
              <div
                className={`mt-[10px] flex items-center gap-[6px] text-[16px] font-semibold ${
                  dayUp ? "text-success" : "text-danger"
                }`}
              >
                {dayUp ? (
                  <ArrowUpRightIcon className="h-4 w-4" />
                ) : (
                  <ArrowDownRightIcon className="h-4 w-4" />
                )}
                {formatSignedCurrency(portfolio.totalDayChange)} (
                {formatPercent(portfolio.totalDayChangePct)}) today
              </div>
            ) : (
              <div className="mt-[10px] text-[14px] text-muted">
                Live prices unavailable — showing ledger.
              </div>
            )}
          </div>

          {series.length >= 2 ? (
            <>
              <div className="mt-2 mb-1">
                <PriceChart
                  bars={series}
                  direction="up"
                  id="portfolio"
                  showHiLo={false}
                />
              </div>
              <p className="mt-2 mb-6 text-xs text-muted-2">
                Cumulative invested capital over time.
              </p>
            </>
          ) : null}

          {/* Stats */}
          <div className="mb-[26px] grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label={<Term>Cost basis</Term>} value={formatCurrency(portfolio.totalCost)} />
            <StatTile
              label={<Term term="Unrealized P&L">Unrealized P&amp;L</Term>}
              value={
                portfolio.hasAnyQuote ? formatSignedCurrency(portfolio.totalUnrealized) : "—"
              }
              secondary={portfolio.hasAnyQuote ? formatPercent(portfolio.totalUnrealizedPct) : undefined}
              tone={portfolio.hasAnyQuote ? (totalUp ? "up" : "down") : undefined}
            />
            <StatTile
              label={<Term term="Realized P&L">Realized P&amp;L</Term>}
              value={formatSignedCurrency(portfolio.totalRealized)}
              tone={portfolio.totalRealized === 0 ? undefined : portfolio.totalRealized > 0 ? "up" : "down"}
            />
            <StatTile
              label="Dividends"
              value={formatCurrency(portfolio.totalDividends)}
            />
          </div>

          {/* Performance */}
          {performance ? (
            <div className="mb-[26px]">
              <PerformanceCard summary={performance} />
            </div>
          ) : null}

          {/* Allocation */}
          {preferences.showAllocationDonut ? (
            <AllocationDonut
              items={portfolio.holdings.map((h) => ({
                ticker: h.ticker,
                value: h.marketValue ?? h.costBasis,
              }))}
              title="Allocation"
              subtitle={portfolio.hasAnyQuote ? "By market value" : "By cost basis"}
            />
          ) : null}

          {/* Tax-drag callout */}
          {locationOverview &&
          (locationOverview.totalEstimatedBleed > 0 ||
            locationOverview.mislocatedCount > 0) ? (
            <section className="mb-[26px] flex flex-wrap items-start justify-between gap-3 rounded-card border border-warning/30 bg-warning/5 px-4 py-4 md:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-text">
                  <Term>Asset location</Term> costing you{" "}
                  <span className="text-warning">
                    {formatCurrency(locationOverview.totalEstimatedBleed)}/yr
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {locationOverview.mislocatedCount} mis-located position
                  {locationOverview.mislocatedCount === 1 ? "" : "s"}
                  {locationOverview.suboptimalCount > 0
                    ? ` and ${locationOverview.suboptimalCount} sub-optimal`
                    : ""}
                  . Open each position&apos;s Tax tab for relocation guidance.
                </p>
              </div>
              <Link
                href="/review"
                className="rounded-[10px] border border-border bg-panel px-3 py-1.5 text-[12px] font-semibold text-text transition-colors hover:bg-panel-2"
              >
                Open tax view
              </Link>
            </section>
          ) : null}

          {/* Holdings */}
          <div className="rounded-card border border-border bg-panel">
            <div className="flex items-center justify-between px-4 py-5 md:px-6">
              <h2 className="text-[16px] font-semibold">Holdings</h2>
              <Link
                href="/portfolio"
                className="text-sm font-semibold text-brand-2 hover:underline"
              >
                See all
              </Link>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
            <div className="grid grid-cols-[1.6fr_0.7fr_0.9fr_0.8fr_1fr_1fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
              <div>Position</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Price</div>
              <div className="text-right">Day</div>
              <div className="text-right">Market value</div>
              <div className="text-right"><Term>Unrealized</Term></div>
            </div>
            {portfolio.holdings.map((h) => {
              const dayUp = (h.dayChangePct ?? 0) >= 0;
              const unrealizedUp = (h.unrealized ?? 0) >= 0;
              return (
                <Link
                  key={h.ticker}
                  href={`/positions/${h.ticker}`}
                  className="grid grid-cols-[1.6fr_0.7fr_0.9fr_0.8fr_1fr_1fr] items-center gap-3 border-t border-border px-4 py-4 transition-colors hover:bg-hover md:px-6"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TickerBadge ticker={h.ticker} />
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold">{h.ticker}</div>
                      <div className="truncate text-xs text-muted">
                        <Term>Cost/sh</Term> {formatCurrency(h.quantity > 0 ? h.costBasis / h.quantity : 0)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-[14px] tabular-nums">{formatQty(h.quantity)}</div>
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
                    {h.marketValue != null ? formatCurrency(h.marketValue) : formatCurrency(h.costBasis)}
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
                </Link>
              );
            })}
              </div>
            </div>
          </div>
        </section>

        {/* Right rail */}
        <aside className="flex w-full flex-col gap-[26px] lg:w-[400px] lg:shrink-0">
          <PMReadCard initialReview={latestReview} hasHoldings={portfolio.holdings.length > 0} />

          <DividendForecastCard summary={dividendForecast} />
          <AttributionCard summary={attribution} />
          <CurrencyExposureCard summary={currencyExposure} />

          <section className="rounded-[22px] border border-border bg-panel p-[22px]">
            <h3 className="mb-3 text-[16px] font-semibold">Add a transaction</h3>
            <p className="mb-5 text-sm leading-relaxed text-muted">
              Log a buy, sell, dividend, or split. Holdings and P&amp;L update instantly.
            </p>
            <Link
              href="/portfolio?tab=transactions"
              className="flex w-full items-center justify-center gap-2 rounded-[28px] bg-gradient-to-r from-brand to-brand-3 py-[15px] text-[15px] font-semibold text-white transition-[filter] hover:brightness-110"
            >
              <PlusIcon className="h-5 w-5" />
              New transaction
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}

function StatTile({
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

function EmptyDashboard() {
  return (
    <div className="mx-auto mt-12 max-w-2xl rounded-card border border-dashed border-border bg-panel/40 p-12 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-panel-2 text-muted">
        <TransactionsIcon className="h-8 w-8" />
      </div>
      <h2 className="text-[24px] font-semibold leading-tight">Welcome to your portfolio</h2>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">
        Record your first buy and we&apos;ll derive holdings, <Term>cost basis</Term>, <Term term="Realized P&L">realized P&amp;L</Term>,
        and dividends from the ledger. Live prices light up the moment you add a position.
      </p>
      <Link
        href="/portfolio?tab=transactions"
        className="mt-8 inline-flex items-center gap-2 rounded-[28px] bg-gradient-to-r from-brand to-brand-3 px-7 py-[14px] text-[15px] font-semibold text-white transition-[filter] hover:brightness-110"
      >
        <PlusIcon className="h-5 w-5" />
        Record first transaction
      </Link>
    </div>
  );
}
