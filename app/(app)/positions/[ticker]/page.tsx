import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PositionChart } from "@/components/position-chart";
import { PositionTabs, type PositionTab } from "@/components/position-tabs";
import { TransactionForm } from "@/components/transaction-form";
import { TransactionsList } from "@/components/transactions-list";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getHolding,
  getTransactionHistory,
  isWatched,
} from "@/lib/portfolio/queries";
import { aboutFor } from "@/lib/portfolio/about";
import { getUserPreferences } from "@/lib/preferences";
import {
  getCandles,
  getFundamentals,
  getIntradayCandles,
  getNews,
  getQuote,
} from "@/lib/marketdata";
import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatQty,
  formatSignedCurrency,
} from "@/lib/format";
import { analyzeHoldingLocation } from "@/lib/canadian/location";
import { LocationBadge } from "@/components/location-badge";
import { FilingsTab } from "@/components/filings-tab";
import { ThesisCard } from "@/components/thesis-card";
import { getLatestQuarterlyAnalysis } from "@/lib/ai/filings";
import { getThesis } from "@/lib/policy/thesis";
import { lookupCik } from "@/lib/filings/edgar";
import { getFilingsForTicker, getInsiderActivity } from "@/lib/filings";
import { isNonRegisteredKind } from "@/lib/portfolio/holdings";
import { Term } from "@/components/term";
import type { BrokerageKind } from "@/generated/prisma";

const KIND_LABEL: Record<BrokerageKind, string> = {
  NON_REGISTERED: "Non-registered",
  JOINT_NON_REGISTERED: "Joint non-registered",
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RESP: "RESP",
  LIRA: "LIRA",
  RRIF: "RRIF",
  CORPORATE: "Corporate",
};

export default async function PositionPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const preferences = await getUserPreferences(session.user.id);

  const [
    holding,
    transactions,
    quote,
    fundamentals,
    news,
    dailyCandles,
    intraday1D,
    intraday1W,
    watched,
    brokerages,
  ] = await Promise.all([
    getHolding(session.user.id, ticker),
    getTransactionHistory(session.user.id, ticker),
    getQuote(ticker),
    preferences.fetchPositionFundamentals ? getFundamentals(ticker) : Promise.resolve(null),
    preferences.fetchPositionNews ? getNews(ticker, 10) : Promise.resolve([]),
    getCandles(ticker, 5 * 365),
    getIntradayCandles(ticker, "1D"),
    getIntradayCandles(ticker, "1W"),
    isWatched(session.user.id, ticker),
    prisma.brokerage.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, kind: true, currency: true },
    }),
  ]);

  const thesis = await getThesis(session.user.id, ticker);
  const [unifiedFilings, insiderTxns, latestQuarterly, cikInfo, tickerListing] = await Promise.all([
    getFilingsForTicker(ticker, { sinceDays: 365 }).catch(() => []),
    getInsiderActivity(ticker, { sinceDays: 180, limit: 20 }).catch(() => []),
    getLatestQuarterlyAnalysis(session.user.id, ticker),
    lookupCik(ticker).catch(() => null),
    prisma.tickerListing.findUnique({ where: { ticker } }).catch(() => null),
  ]);

  if (!holding && transactions.length === 0 && !quote) notFound();

  const about = aboutFor(ticker);
  const companyName = fundamentals?.companyName ?? ticker;

  const marketValue = quote && holding ? quote.price * holding.quantity : null;
  const unrealized = marketValue != null && holding ? marketValue - holding.costBasis : null;
  const unrealizedPct =
    unrealized != null && holding && holding.costBasis > 0
      ? (unrealized / holding.costBasis) * 100
      : null;

  const toBars = (cs: typeof dailyCandles) =>
    cs.map((c) => ({ ts: c.ts.getTime(), close: c.close }));
  const dailyBars = toBars(dailyCandles);
  const intraday1DBars = toBars(intraday1D);
  const intraday1WBars = toBars(intraday1W);

  // ─── Tab content ─────────────────────────────────────────────────
  const overview = (
    <>
      {holding ? (
        <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
          <h3 className="mb-4 text-[16px] font-semibold">Your position</h3>
          <div className="grid grid-cols-4 gap-4">
            <PosTile label="Shares" value={formatQty(holding.quantity)} />
            <PosTile
              label={<Term>Cost/sh</Term>}
              value={formatCurrency(holding.quantity > 0 ? holding.costBasis / holding.quantity : 0)}
            />
            <PosTile label={<Term>Cost basis</Term>} value={formatCurrency(holding.costBasis)} />
            <PosTile
              label="Market value"
              value={marketValue != null ? formatCurrency(marketValue) : "—"}
            />
            <PosTile
              label={<Term term="Unrealized P&L">Unrealized P&amp;L</Term>}
              value={unrealized != null ? formatSignedCurrency(unrealized) : "—"}
              secondary={unrealizedPct != null ? formatPercent(unrealizedPct) : undefined}
              tone={unrealized == null ? undefined : unrealized >= 0 ? "up" : "down"}
            />
            <PosTile
              label={<Term term="Realized P&L">Realized P&amp;L</Term>}
              value={
                holding.realizedGain === 0 ? "—" : formatSignedCurrency(holding.realizedGain)
              }
              tone={
                holding.realizedGain === 0
                  ? undefined
                  : holding.realizedGain > 0
                    ? "up"
                    : "down"
              }
            />
            <PosTile
              label="Dividends"
              value={
                holding.totalDividends === 0 ? "—" : formatCurrency(holding.totalDividends)
              }
            />
            <PosTile label="Holding period" value={holdingPeriod(holding.openedAt)} />
          </div>
        </section>
      ) : null}

      {about ? (
        <section className="mb-[26px]">
          <h2 className="mb-4 text-[20px] font-semibold">About {ticker}</h2>
          <p className="text-[14px] leading-[1.7] text-soft">{about}</p>
          {fundamentals?.weburl ? (
            <a
              href={fundamentals.weburl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-semibold text-brand-2 hover:underline"
            >
              Visit company website →
            </a>
          ) : null}
        </section>
      ) : null}

      {!holding && !about ? (
        <div className="mx-auto max-w-md rounded-card border border-dashed border-border bg-panel/40 p-8 text-center text-sm text-muted">
          You don&apos;t hold this ticker yet. Use the form on the right to record a position
          or remove the star to drop it from your watchlist.
        </div>
      ) : null}
    </>
  );

  const newsSection = news.length > 0 ? (
    <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[16px] font-semibold">Latest news</h3>
        <span className="text-xs text-muted">{news.length} stories</span>
      </div>
      <div className="divide-y divide-border">
        {news.map((n) => (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="-mx-2 block rounded-[8px] px-2 py-4 transition-colors first:pt-2 last:pb-2 hover:bg-panel-2/40"
          >
            <div className="text-[15px] font-semibold leading-snug text-text">{n.headline}</div>
            {n.summary ? (
              <div className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-soft">
                {n.summary}
              </div>
            ) : null}
            <div className="mt-2 text-xs text-muted">
              {n.source} · {timeAgo(n.publishedAt)}
            </div>
          </a>
        ))}
      </div>
    </section>
  ) : null;

  const fundamentalsSection = fundamentals ? (
    <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
      <h3 className="mb-4 text-[16px] font-semibold">Fundamentals</h3>
      <div className="grid grid-cols-4 gap-x-4 gap-y-5">
        {fundamentals.marketCap != null ? (
          <PosTile label="Market cap" value={formatCompactCurrency(fundamentals.marketCap)} />
        ) : null}
        {fundamentals.peTtm != null ? (
          <PosTile label={<><Term>P/E</Term> (TTM)</>} value={fundamentals.peTtm.toFixed(1)} />
        ) : null}
        {fundamentals.dividendYield != null ? (
          <PosTile
            label="Dividend yield"
            value={(fundamentals.dividendYield * 100).toFixed(2) + "%"}
          />
        ) : null}
        {fundamentals.beta != null ? (
          <PosTile label={<Term>Beta</Term>} value={fundamentals.beta.toFixed(2)} />
        ) : null}
        {fundamentals.fiftyTwoHigh != null ? (
          <PosTile label="52w high" value={formatCurrency(fundamentals.fiftyTwoHigh)} />
        ) : null}
        {fundamentals.fiftyTwoLow != null ? (
          <PosTile label="52w low" value={formatCurrency(fundamentals.fiftyTwoLow)} />
        ) : null}
        {fundamentals.industry ? (
          <PosTile label="Industry" value={fundamentals.industry} />
        ) : null}
        {fundamentals.exchange ? (
          <PosTile label="Exchange" value={fundamentals.exchange} />
        ) : null}
      </div>
    </section>
  ) : null;

  const transactionsSection = transactions.length > 0 ? (
    <section className="mb-[26px]">
      <TransactionsList transactions={transactions} brokerages={brokerages} />
    </section>
  ) : null;

  // ─── Tax view ──────────────────────────────────────────────────
  const locationAnalysis = holding
    ? analyzeHoldingLocation({
        ticker,
        byKind: holding.byKind,
        marketPrice: quote?.price ?? null,
        fundamentals,
      })
    : null;

  const taxableUnrealized =
    holding && quote && holding.nonRegQuantity > 0
      ? (quote.price - holding.acb) * holding.nonRegQuantity
      : null;
  const taxableUnrealizedAfterInclusion =
    taxableUnrealized != null ? taxableUnrealized * 0.5 : null;

  const taxSection = holding ? (
    <>
      {/* ACB summary */}
      <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
        <h3 className="mb-4 text-[16px] font-semibold"><Term>ACB</Term> &amp; <Term term="Capital gain">capital gain</Term></h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <PosTile
            label={<><Term>ACB</Term> (non-reg)</>}
            value={
              holding.nonRegQuantity > 0
                ? `${formatCurrency(holding.acb)}/sh`
                : "—"
            }
          />
          <PosTile
            label="Non-reg shares"
            value={formatQty(holding.nonRegQuantity)}
          />
          <PosTile
            label={<>Non-reg <Term>cost basis</Term></>}
            value={formatCurrency(holding.nonRegCostBasis)}
          />
          <PosTile
            label={<><Term term="Realized P&L">Realized P&amp;L</Term> (lifetime)</>}
            value={
              holding.realizedGain === 0
                ? "—"
                : formatSignedCurrency(holding.realizedGain)
            }
            tone={
              holding.realizedGain === 0
                ? undefined
                : holding.realizedGain > 0
                  ? "up"
                  : "down"
            }
          />
          <PosTile
            label={<Term>Unrealized cap gain</Term>}
            value={
              taxableUnrealized != null ? formatSignedCurrency(taxableUnrealized) : "—"
            }
            tone={
              taxableUnrealized == null
                ? undefined
                : taxableUnrealized >= 0
                  ? "up"
                  : "down"
            }
            secondary={
              taxableUnrealized != null
                ? <>non-reg slice × (price − <Term>ACB</Term>)</>
                : undefined
            }
          />
          <PosTile
            label="50% inclusion"
            value={
              taxableUnrealizedAfterInclusion != null
                ? formatSignedCurrency(taxableUnrealizedAfterInclusion)
                : "—"
            }
            secondary={<>taxable portion at <Term term="Disposition">disposition</Term></>}
            tone={
              taxableUnrealizedAfterInclusion == null
                ? undefined
                : taxableUnrealizedAfterInclusion >= 0
                  ? "up"
                  : "down"
            }
          />
          <PosTile
            label="Dividends received"
            value={
              holding.totalDividends === 0 ? "—" : formatCurrency(holding.totalDividends)
            }
          />
          <PosTile
            label={<Term>Foreign tax withheld</Term>}
            value={
              holding.totalForeignTaxWithheld === 0
                ? "—"
                : formatCurrency(holding.totalForeignTaxWithheld)
            }
          />
        </div>
      </section>

      {/* Per-account breakdown */}
      <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[16px] font-semibold">Per-account breakdown</h3>
          {locationAnalysis && locationAnalysis.totalEstimatedBleed > 0 ? (
            <span className="text-xs font-medium text-danger">
              ~{formatCurrency(locationAnalysis.totalEstimatedBleed)}/yr in avoidable tax drag
            </span>
          ) : null}
        </div>
        {locationAnalysis && locationAnalysis.perKind.length > 0 ? (
          <div className="space-y-3">
            {locationAnalysis.perKind.map((slice) => {
              const sliceData = holding.byKind[slice.currentKind];
              const sliceQty = sliceData?.quantity ?? 0;
              const sliceMV = quote ? quote.price * sliceQty : null;
              return (
                <div
                  key={slice.currentKind}
                  className="rounded-[10px] border border-border bg-bg/40 p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold">
                        {KIND_LABEL[slice.currentKind]}
                      </span>
                      <LocationBadge score={slice.score} />
                    </div>
                    <span className="text-xs text-muted">
                      {formatQty(sliceQty)} sh ·{" "}
                      {sliceMV != null ? formatCurrency(sliceMV) : "no quote"}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-soft">
                    {slice.reasoning}
                  </p>
                  {slice.optimalKind && slice.optimalKind !== slice.currentKind ? (
                    <p className="mt-1 text-xs text-muted-2">
                      Optimal: <span className="font-semibold">{KIND_LABEL[slice.optimalKind]}</span>
                      {slice.estimatedAnnualBleed > 0
                        ? ` · ~${formatCurrency(slice.estimatedAnnualBleed)}/yr saved by relocating`
                        : ""}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No active position slices to analyze.
          </p>
        )}
      </section>

      {/* Projected annual dividend + FWT */}
      {locationAnalysis && locationAnalysis.totalExpectedAnnualDividend > 0 ? (
        <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
          <h3 className="mb-4 text-[16px] font-semibold">Projected annual income</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <PosTile
              label="Expected dividends"
              value={formatCurrency(locationAnalysis.totalExpectedAnnualDividend)}
              secondary="based on current yield"
            />
            <PosTile
              label="Foreign tax cost"
              value={formatCurrency(locationAnalysis.totalExpectedAnnualFWT)}
              secondary="withheld at source"
            />
            <PosTile
              label="Avoidable drag"
              value={formatCurrency(locationAnalysis.totalEstimatedBleed)}
              secondary="if relocated to optimal accounts"
              tone={locationAnalysis.totalEstimatedBleed > 0 ? "down" : undefined}
            />
          </div>
        </section>
      ) : null}
    </>
  ) : null;

  const filingsSection = (
    <FilingsTab
      ticker={ticker}
      filings={unifiedFilings}
      insiderTransactions={insiderTxns}
      latestSummary={latestQuarterly}
      isUsListed={cikInfo != null}
      hasCseListing={tickerListing?.cseIssuerId != null && Boolean(tickerListing?.cseSlug)}
      isCseTicker={/\.CN$/i.test(ticker)}
    />
  );

  const thesisSection = <ThesisCard ticker={ticker} initial={thesis} />;

  const tabs: PositionTab[] = [{ key: "Overview", content: overview }];
  tabs.push({ key: "Thesis", content: thesisSection });
  if (newsSection) tabs.push({ key: "News", content: newsSection });
  if (fundamentalsSection) tabs.push({ key: "Fundamentals", content: fundamentalsSection });
  tabs.push({ key: "Filings", content: filingsSection });
  if (taxSection) tabs.push({ key: "Tax", content: taxSection });
  if (transactionsSection) tabs.push({ key: "Transactions", content: transactionsSection });

  return (
    <>
      <Topbar title={companyName} backHref="/portfolio" />
      <div className="flex flex-col gap-6 px-4 pb-12 pt-6 md:px-6 lg:flex-row lg:items-start lg:gap-[34px] lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <section className="min-w-0 lg:flex-1">
          <PositionChart
            ticker={ticker}
            baseQuote={quote}
            daily={dailyBars}
            intraday1D={intraday1DBars}
            intraday1W={intraday1WBars}
            initialRange="1M"
            watched={watched}
          />

          <PositionTabs tabs={tabs} />
        </section>

        <aside className="w-full lg:w-[400px] lg:shrink-0">
          <div className="lg:sticky lg:top-[96px]">
            <TransactionForm defaultTicker={ticker} brokerages={brokerages} />
          </div>
        </aside>
      </div>
    </>
  );
}

function PosTile({
  label,
  value,
  secondary,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  secondary?: React.ReactNode;
  tone?: "up" | "down";
}) {
  const color = tone === "up" ? "text-success" : tone === "down" ? "text-danger" : "text-text";
  return (
    <div>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-[18px] font-semibold tabular-nums ${color}`}>{value}</div>
      {secondary ? (
        <div className={`text-xs font-medium tabular-nums ${color}`}>{secondary}</div>
      ) : null}
    </div>
  );
}

function holdingPeriod(openedAt: Date): string {
  const ms = Date.now() - openedAt.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = (days / 365).toFixed(1);
  return `${years}y`;
}

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
