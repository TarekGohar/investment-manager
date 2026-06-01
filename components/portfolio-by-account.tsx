import Link from "next/link";
import type { BrokerageKind } from "@/generated/prisma";
import type { EnrichedPortfolio } from "@/lib/portfolio/types";
import { TickerBadge } from "@/components/ticker-badge";
import {
  formatCurrency,
  formatPercent,
  formatQty,
  formatSignedCurrency,
} from "@/lib/format";

type AccountInfo = {
  brokerageId: string;
  brokerageName: string;
  brokerageKind: BrokerageKind;
};

type AccountGroup = {
  info: AccountInfo;
  rows: GroupRow[];
  /** Account totals in CAD (mixed-currency positions normalized via today's
   *  USD/CAD rate). */
  totalCostCad: number;
  totalMarketValueCad: number;
  totalUnrealizedCad: number;
  hasAnyQuote: boolean;
};

type GroupRow = {
  ticker: string;
  /** Native currency of the position — display per-row values in this. */
  currency: string;
  quantity: number;
  costBasis: number;
  /** Per-share cost basis used in this account slice (ACB for non-reg pool;
   *  weighted average for registered). */
  perShareCost: number;
  marketPrice: number | null;
  marketValue: number | null;
  unrealized: number | null;
  unrealizedPct: number | null;
  marketValueCad: number | null;
  costBasisCad: number;
};

const KIND_LABEL: Record<string, string> = {
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RESP: "RESP",
  LIRA: "LIRA",
  RRIF: "RRIF",
  NON_REGISTERED: "Non-registered",
  JOINT_NON_REGISTERED: "Joint non-registered",
  CORPORATE: "Corporate",
};

const KIND_TONE: Record<string, string> = {
  TFSA: "bg-success/15 text-success",
  RRSP: "bg-brand/15 text-brand-2",
  FHSA: "bg-warning/15 text-warning",
  RESP: "bg-warning/15 text-warning",
  LIRA: "bg-muted/15 text-muted",
  RRIF: "bg-muted/15 text-muted",
  NON_REGISTERED: "bg-danger/15 text-danger",
  JOINT_NON_REGISTERED: "bg-danger/15 text-danger",
  CORPORATE: "bg-muted/15 text-muted",
};

export function PortfolioByAccount({
  portfolio,
  brokerages,
}: {
  portfolio: EnrichedPortfolio;
  brokerages: AccountInfo[];
}) {
  const brokerageInfoById = new Map(brokerages.map((b) => [b.brokerageId, b]));

  // Expand each holding's `byKind` into per-brokerage rows. Note: `byKind`
  // aggregates ACROSS brokerages of the same kind, so we re-slice via the
  // transaction-level data we already have on the Holding... actually
  // byKind is just per-kind, not per-brokerage. For per-brokerage, we'd
  // need to thread brokerageId all the way through holdings derivation.
  //
  // For now: group by kind. Most users (incl. this one) have one brokerage
  // per kind, so this practically maps 1:1. If a user has two TFSAs they'll
  // see them merged — fixable in a future pass.
  const groups = new Map<BrokerageKind, AccountGroup>();

  // The CAD-conversion factor is the ratio between this holding's CAD and
  // native totals at portfolio level — same FX rate the enrichment used.
  const holdingFxToCad = new Map<string, number>();
  for (const h of portfolio.holdings) {
    if (h.costBasis > 0 && h.costBasisCad > 0) {
      holdingFxToCad.set(h.ticker, h.costBasisCad / h.costBasis);
    } else {
      holdingFxToCad.set(h.ticker, 1);
    }
  }

  for (const h of portfolio.holdings) {
    const fxToCad = holdingFxToCad.get(h.ticker) ?? 1;
    for (const [kindRaw, slice] of Object.entries(h.byKind)) {
      const kind = kindRaw as BrokerageKind;
      if (slice.quantity <= 1e-9) continue;
      const broker =
        brokerages.find((b) => b.brokerageKind === kind) ?? {
          brokerageId: kind,
          brokerageName: KIND_LABEL[kind] ?? kind,
          brokerageKind: kind,
        };
      let group = groups.get(kind);
      if (!group) {
        group = {
          info: broker,
          rows: [],
          totalCostCad: 0,
          totalMarketValueCad: 0,
          totalUnrealizedCad: 0,
          hasAnyQuote: false,
        };
        groups.set(kind, group);
      }
      const perShareCost = slice.quantity > 0 ? slice.costBasis / slice.quantity : 0;
      const marketPrice = h.marketPrice;
      const marketValue = marketPrice != null ? marketPrice * slice.quantity : null;
      const unrealized = marketValue != null ? marketValue - slice.costBasis : null;
      const unrealizedPct =
        unrealized != null && slice.costBasis > 0
          ? (unrealized / slice.costBasis) * 100
          : null;
      const costBasisCad = slice.costBasis * fxToCad;
      const marketValueCad = marketValue != null ? marketValue * fxToCad : null;
      group.rows.push({
        ticker: h.ticker,
        currency: h.currency,
        quantity: slice.quantity,
        costBasis: slice.costBasis,
        perShareCost,
        marketPrice,
        marketValue,
        unrealized,
        unrealizedPct,
        marketValueCad,
        costBasisCad,
      });
      group.totalCostCad += costBasisCad;
      if (marketValueCad != null) {
        group.totalMarketValueCad += marketValueCad;
        group.hasAnyQuote = true;
        group.totalUnrealizedCad += marketValueCad - costBasisCad;
      }
    }
  }

  if (groups.size === 0) return null;

  // Sort: largest by CAD market value (or cost) first.
  const ordered = Array.from(groups.values()).sort((a, b) => {
    const av = a.hasAnyQuote ? a.totalMarketValueCad : a.totalCostCad;
    const bv = b.hasAnyQuote ? b.totalMarketValueCad : b.totalCostCad;
    return bv - av;
  });

  // Use brokerageInfoById to suppress an unused warning when info isn't surfaced
  void brokerageInfoById;

  return (
    <section className="space-y-3">
      <h2 className="text-[16px] font-semibold">By account</h2>
      {ordered.map((g) => (
        <AccountSection key={g.info.brokerageKind} group={g} />
      ))}
    </section>
  );
}

function AccountSection({ group }: { group: AccountGroup }) {
  const kindTone = KIND_TONE[group.info.brokerageKind] ?? "bg-muted/15 text-muted";
  return (
    <div className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${kindTone}`}
          >
            {KIND_LABEL[group.info.brokerageKind] ?? group.info.brokerageKind}
          </span>
          <span className="text-[15px] font-semibold">{group.info.brokerageName}</span>
          <span className="text-xs text-muted">
            {group.rows.length} position{group.rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">
              {group.hasAnyQuote ? "Value (CAD)" : "Cost (CAD)"}
            </div>
            <div className="text-[14px] font-semibold tabular-nums">
              {formatCurrency(group.hasAnyQuote ? group.totalMarketValueCad : group.totalCostCad)}
            </div>
          </div>
          {group.hasAnyQuote ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">
                Unrealized (CAD)
              </div>
              <div
                className={`text-[14px] font-semibold tabular-nums ${
                  group.totalUnrealizedCad >= 0 ? "text-success" : "text-danger"
                }`}
              >
                {formatSignedCurrency(group.totalUnrealizedCad)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[1.5fr_0.6fr_0.8fr_0.8fr_0.9fr_0.9fr] gap-3 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
            <div>Ticker</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Avg cost</div>
            <div className="text-right">Price</div>
            <div className="text-right">Value</div>
            <div className="text-right">Unrealized</div>
          </div>
          {group.rows
            .sort(
              (a, b) =>
                (b.marketValueCad ?? b.costBasisCad) - (a.marketValueCad ?? a.costBasisCad),
            )
            .map((r) => (
              <Link
                key={r.ticker}
                href={`/positions/${r.ticker}`}
                className="grid grid-cols-[1.5fr_0.6fr_0.8fr_0.8fr_0.9fr_0.9fr] items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-hover md:px-6"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <TickerBadge ticker={r.ticker} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold">{r.ticker}</div>
                    <div className="truncate text-[10px] uppercase tracking-wide text-muted-2">
                      {r.currency}
                    </div>
                  </div>
                </div>
                <div className="text-right text-[13px] tabular-nums">
                  {formatQty(r.quantity)}
                </div>
                <div className="text-right text-[13px] tabular-nums">
                  {formatCurrency(r.perShareCost)}
                </div>
                <div className="text-right text-[13px] tabular-nums">
                  {r.marketPrice != null ? formatCurrency(r.marketPrice) : "—"}
                </div>
                <div className="text-right text-[13px] font-semibold tabular-nums">
                  {r.marketValue != null ? formatCurrency(r.marketValue) : formatCurrency(r.costBasis)}
                </div>
                <div
                  className={`text-right text-[13px] font-semibold tabular-nums ${
                    r.unrealized == null
                      ? "text-muted"
                      : r.unrealized >= 0
                        ? "text-success"
                        : "text-danger"
                  }`}
                >
                  {r.unrealized != null
                    ? `${formatSignedCurrency(r.unrealized)}${r.unrealizedPct != null ? ` (${formatPercent(r.unrealizedPct)})` : ""}`
                    : "—"}
                </div>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
