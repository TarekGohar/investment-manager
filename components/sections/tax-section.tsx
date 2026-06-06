import Link from "next/link";
import { LocationBadge } from "@/components/location-badge";
import { TickerBadge } from "@/components/ticker-badge";
import { Term } from "@/components/term";
import { TlhCandidates } from "@/components/tlh-candidates";
import { ContributionRoomStatusCard } from "@/components/contribution-room-status";
import { getContributionRoomStatus } from "@/lib/canadian/contribution-room";
import { RoCAllocationSection } from "@/components/roc-allocation-section";
import { listRoCAllocations } from "@/lib/canadian/reit-decomposition";
import { getUserPreferences } from "@/lib/preferences";
import { getEnrichedPortfolio, listTransactions } from "@/lib/portfolio/queries";
import { analyzePortfolioLocation } from "@/lib/canadian/location";
import { getFwtRollupsRecent } from "@/lib/canadian/fwt";
import { findTlhCandidates } from "@/lib/canadian/tlh";
import {
  detectSuperficialLosses,
  getActiveSuperficialLossWindows,
} from "@/lib/canadian/superficial-loss";
import { formatCurrency, formatSignedCurrency } from "@/lib/format";
import type { BrokerageKind } from "@/generated/prisma";

const KIND_LABEL: Record<BrokerageKind, string> = {
  NON_REGISTERED: "Non-registered",
  JOINT_NON_REGISTERED: "Joint non-reg",
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RESP: "RESP",
  LIRA: "LIRA",
  RRIF: "RRIF",
  CORPORATE: "Corporate",
};

export async function TaxSection({ userId }: { userId: string }) {
  const portfolio = await getEnrichedPortfolio(userId);

  const currentYear = new Date().getUTCFullYear();
  const [locationOverview, fwtRollups, transactions, preferences, roomStatuses, rocAllocations] =
    await Promise.all([
      portfolio.holdings.length > 0
        ? analyzePortfolioLocation(portfolio.holdings)
        : Promise.resolve(null),
      getFwtRollupsRecent(userId, 3),
      listTransactions(userId),
      getUserPreferences(userId),
      getContributionRoomStatus(userId, currentYear),
      listRoCAllocations(userId),
    ]);

  const capGainsRate = preferences.taxProfile.marginalCapGainsRate;
  const tlhCandidates = findTlhCandidates({
    holdings: portfolio.holdings,
    transactions,
    capGainsRate,
  });

  const superficialViolations = detectSuperficialLosses(transactions);
  const activeWindows = getActiveSuperficialLossWindows(transactions);

  const taxableUnrealized = portfolio.holdings.reduce((sum, h) => {
    if (h.marketPrice == null || h.nonRegQuantity <= 0) return sum;
    return sum + (h.marketPrice - h.acb) * h.nonRegQuantity;
  }, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-[26px]">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={<><Term term="Realized P&L">Realized P&amp;L</Term> (lifetime)</>}
          value={
            portfolio.totalRealized === 0
              ? "—"
              : formatSignedCurrency(portfolio.totalRealized)
          }
          hint={<>From non-registered sells, <Term>ACB</Term>-based</>}
          tone={
            portfolio.totalRealized === 0
              ? undefined
              : portfolio.totalRealized > 0
                ? "up"
                : "down"
          }
        />
        <Stat
          label={<><Term>Unrealized cap gain</Term></>}
          value={
            portfolio.hasAnyQuote ? formatSignedCurrency(taxableUnrealized) : "—"
          }
          hint={<>Non-reg slice only · 50% inclusion at <Term term="Disposition">disposition</Term></>}
          tone={
            !portfolio.hasAnyQuote
              ? undefined
              : taxableUnrealized >= 0
                ? "up"
                : "down"
          }
        />
        <Stat
          label="Dividends received"
          value={formatCurrency(portfolio.totalDividends)}
          hint="All accounts, lifetime"
        />
        <Stat
          label={<><Term term="Foreign tax withheld">Foreign tax withheld</Term></>}
          value={formatCurrency(portfolio.totalForeignTaxWithheld)}
          hint={<>Recoverable on non-reg via T1 <Term>FTC</Term></>}
        />
      </section>

      <ContributionRoomStatusCard statuses={roomStatuses} year={currentYear} />

      <section className="rounded-card border border-border bg-panel px-4 py-4 md:px-6">
        <h2 className="mb-3 text-[16px] font-semibold">
          REIT &amp; trust <Term>T3</Term> decomposition
        </h2>
        <RoCAllocationSection
          initial={rocAllocations}
          currentYear={currentYear}
        />
      </section>

      <TlhCandidates
        candidates={tlhCandidates}
        hasMarginalRate={capGainsRate != null}
      />

      {activeWindows.length > 0 ? (
        <section className="rounded-card border border-warning/30 bg-warning/5 px-4 py-4 md:px-6">
          <h2 className="text-[16px] font-semibold">Active no-buyback windows</h2>
          <p className="mt-1 text-xs text-muted">
            Buying these tickers before the window closes will trigger the
            CRA <Term term="Superficial loss">superficial-loss</Term> rule — your realized loss gets disallowed
            and rolled into the new purchase&apos;s <Term>ACB</Term>.
          </p>
          <div className="mt-3 space-y-2">
            {activeWindows.map((w) => (
              <div
                key={w.saleTransactionId}
                className="flex items-center justify-between rounded-[10px] bg-bg/40 px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <TickerBadge ticker={w.ticker} size={28} />
                  <div>
                    <div className="text-[14px] font-semibold">{w.ticker}</div>
                    <div className="text-xs text-muted">
                      Sold {w.saleDate.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                      {" · "}loss {formatCurrency(w.lossAmount)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-semibold tabular-nums text-warning">
                    {w.daysRemaining} day{w.daysRemaining === 1 ? "" : "s"} left
                  </div>
                  <div className="text-xs text-muted-2">
                    Safe buyback{" "}
                    {w.windowEndsAt.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {superficialViolations.length > 0 ? (
        <section className="rounded-card border border-danger/30 bg-danger/5 px-4 py-4 md:px-6">
          <h2 className="text-[16px] font-semibold">Disallowed losses (superficial)</h2>
          <p className="mt-1 text-xs text-muted">
            These sales triggered the <Term term="Superficial loss">superficial loss</Term> rule — the loss was
            disallowed and rolled into the <Term>ACB</Term> of substituted shares. Your
            displayed <Term>ACB</Term> already reflects this adjustment.
          </p>
          <div className="mt-3 space-y-2">
            {superficialViolations.map((v) => (
              <div
                key={v.saleTransactionId}
                className="rounded-[10px] bg-bg/40 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold">{v.ticker}</span>
                    <span className="text-xs text-muted">
                      sold{" "}
                      {v.saleDate.toLocaleDateString("en-CA", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <span className="text-[14px] font-semibold tabular-nums text-danger">
                    {formatCurrency(v.lossAmount)} disallowed
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  Conflicting{" "}
                  {v.conflictingBuys
                    .map(
                      (b) =>
                        `${b.relationToSale === "before" ? "earlier" : "later"} buy ${b.daysApart}d ${b.relationToSale}`,
                    )
                    .join(", ")}
                  {" · "}absorbed by{" "}
                  {v.absorbedBy.kind === "remaining"
                    ? "remaining shares"
                    : "subsequent purchase"}
                  .
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-card border border-border bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
          <h2 className="text-[16px] font-semibold"><Term>Asset location</Term></h2>
          {locationOverview ? (
            <span className="text-xs text-muted">
              {locationOverview.mislocatedCount + locationOverview.suboptimalCount}{" "}
              position
              {locationOverview.mislocatedCount +
                locationOverview.suboptimalCount ===
              1
                ? ""
                : "s"}{" "}
              could be better located · ~
              <span className="font-semibold text-warning">
                {formatCurrency(locationOverview.totalEstimatedBleed)}/yr
              </span>{" "}
              avoidable drag
            </span>
          ) : null}
        </div>

        {!locationOverview || locationOverview.byTicker.size === 0 ? (
          <div className="border-t border-border px-6 py-10 text-center text-sm text-muted">
            Add transactions and open a few position pages to populate location analysis.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[1.5fr_1fr_0.9fr_1fr_1fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
                <div>Ticker</div>
                <div>Account</div>
                <div className="text-right">Status</div>
                <div className="text-right">Suggested move</div>
                <div className="text-right">Annual cost</div>
              </div>
              {Array.from(locationOverview.byTicker.values()).flatMap((analysis) =>
                analysis.perKind.map((slice) => (
                  <div
                    key={`${analysis.ticker}-${slice.currentKind}`}
                    className="grid grid-cols-[1.5fr_1fr_0.9fr_1fr_1fr] items-center gap-3 border-t border-border px-4 py-3 md:px-6"
                  >
                    <Link
                      href={`/positions/${analysis.ticker}`}
                      className="flex min-w-0 items-center gap-3 hover:underline"
                    >
                      <TickerBadge ticker={analysis.ticker} size={28} />
                      <span className="truncate text-[14px] font-semibold">
                        {analysis.ticker}
                      </span>
                    </Link>
                    <div className="text-[13px] text-soft">
                      {KIND_LABEL[slice.currentKind]}
                    </div>
                    <div className="flex justify-end">
                      <LocationBadge score={slice.score} size="sm" />
                    </div>
                    <div className="text-right text-[13px] text-muted">
                      {slice.optimalKind && slice.optimalKind !== slice.currentKind
                        ? KIND_LABEL[slice.optimalKind]
                        : "—"}
                    </div>
                    <div
                      className={`text-right text-[14px] font-semibold tabular-nums ${
                        slice.estimatedAnnualBleed > 0 ? "text-warning" : "text-muted"
                      }`}
                    >
                      {slice.estimatedAnnualBleed > 0
                        ? `~${formatCurrency(slice.estimatedAnnualBleed)}`
                        : "—"}
                    </div>
                  </div>
                )),
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-card border border-border bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
          <h2 className="text-[16px] font-semibold"><Term>Foreign withholding tax</Term></h2>
          <span className="text-xs text-muted">Recent 4 years</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-[0.6fr_1fr_1fr_1fr_1fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
              <div>Year</div>
              <div className="text-right">Total <Term>FWT</Term></div>
              <div className="text-right">Recoverable (non-reg)</div>
              <div className="text-right">Lost (<Term>TFSA</Term>/<Term>FHSA</Term>)</div>
              <div className="text-right"><Term>RRSP</Term> (should be $0)</div>
            </div>
            {fwtRollups.length === 0 ? (
              <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
                No foreign dividends recorded yet. Use the{" "}
                <span className="font-mono">foreignTaxWithheld</span> field on
                DIVIDEND transactions to track it.
              </div>
            ) : (
              fwtRollups.map((rollup) => (
                <div
                  key={rollup.year}
                  className="grid grid-cols-[0.6fr_1fr_1fr_1fr_1fr] items-center gap-3 border-t border-border px-4 py-3 md:px-6"
                >
                  <div className="text-[14px] font-semibold">{rollup.year}</div>
                  <div className="text-right text-[14px] tabular-nums">
                    {formatCurrency(rollup.totalFwt)}
                  </div>
                  <div className="text-right text-[14px] tabular-nums text-success">
                    {formatCurrency(rollup.recoverable)}
                  </div>
                  <div className="text-right text-[14px] tabular-nums text-danger">
                    {formatCurrency(rollup.lost)}
                  </div>
                  <div
                    className={`text-right text-[14px] tabular-nums ${
                      rollup.treatyExemptOrBrokerBug > 0
                        ? "text-warning"
                        : "text-muted"
                    }`}
                  >
                    {formatCurrency(rollup.treatyExemptOrBrokerBug)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <p className="px-4 pb-4 pt-2 text-xs text-muted-2 md:px-6">
          CRA recovers <Term>FWT</Term> on non-registered foreign dividends via your T1 foreign
          tax credit. <Term>TFSA</Term>/<Term>FHSA</Term> losses are permanent — the treaty doesn&apos;t
          recognize them. <Term>RRSP</Term> should be $0; non-zero means your broker may not
          have W-8BEN on file.
        </p>
      </section>

      <section className="rounded-card border border-border bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
          <h2 className="text-[16px] font-semibold">Year-end slip prep</h2>
          <span className="text-xs text-muted">{currentYear} · CSV downloads</span>
        </div>
        <div className="space-y-3 border-t border-border px-4 py-4 md:px-6">
          <SlipRow
            title={<><Term>T5</Term>-style — investment income</>}
            description={<>Per-ticker dividend + foreign tax withheld summary for your non-registered accounts. Cross-check against the <Term>T5</Term> slips your broker issues.</>}
            downloads={[
              {
                label: "Non-registered only",
                href: `/api/tax/slips?slip=t5&year=${currentYear}`,
              },
              {
                label: "All accounts (incl. registered)",
                href: `/api/tax/slips?slip=t5&year=${currentYear}&includeRegistered=true`,
              },
            ]}
          />
          <SlipRow
            title={<><Term>T5008</Term>-style — <Term term="Disposition">dispositions</Term></>}
            description={<>Each SELL in your non-registered accounts with proceeds, <Term>ACB</Term>, and resulting <Term term="Capital gain">capital gain</Term> or loss. <Term term="Superficial loss">Superficial-loss</Term> rows are flagged.</>}
            downloads={[
              {
                label: "Download",
                href: `/api/tax/slips?slip=t5008&year=${currentYear}`,
              },
            ]}
          />
          <p className="text-xs text-muted-2">
            The T5 export buckets income by type (eligible / non-eligible
            dividend, interest, foreign, return of capital) and reports
            each currency separately — no FX conversion. For non-CAD
            income, convert to CAD using the Bank of Canada exchange rate
            at the time of receipt (or the annual average) per CRA
            guidance before filing. Untagged dividends fall into an
            &ldquo;Untagged — set type&rdquo; bucket so you can spot them.
          </p>
        </div>
      </section>

      <p className="text-xs text-muted-2">
        Set your marginal rates and contribution room in Settings so the
        warnings, dollar estimates, and slip rollups reflect your actual
        situation — nothing is assumed.
      </p>
    </div>
  );
}

function SlipRow({
  title,
  description,
  downloads,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  downloads: Array<{ label: string; href: string }>;
}) {
  return (
    <div className="rounded-[10px] bg-bg/40 px-3 py-3">
      <div className="text-[14px] font-semibold">{title}</div>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {downloads.map((d) => (
          <a
            key={d.href}
            href={d.href}
            download
            className="rounded-[8px] border border-border bg-panel px-2.5 py-1 text-xs font-semibold hover:bg-bg"
          >
            {d.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  hint?: React.ReactNode;
  tone?: "up" | "down";
}) {
  const color = tone === "up" ? "text-success" : tone === "down" ? "text-danger" : "text-text";
  return (
    <div className="rounded-card border border-border bg-panel px-5 py-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold tabular-nums ${color}`}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-2">{hint}</div> : null}
    </div>
  );
}
