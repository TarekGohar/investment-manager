import { Term } from "@/components/term";
import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
} from "@/lib/format";
import type { TickerInsights } from "@/lib/marketdata";

const RECO_LABEL: Record<string, string> = {
  strong_buy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  underperform: "Underperform",
  sell: "Sell",
};

function pct1(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function ratio(v: number | null, digits = 1): string {
  return v == null ? "—" : v.toFixed(digits);
}

/**
 * Wall-Street view + valuation snapshot for a position, sourced from Yahoo's
 * quoteSummary. Renders nothing useful-less: every block is guarded so a name
 * with thin coverage just shows what's available. Prices are in the security's
 * listing currency.
 */
export function StreetView({ insights }: { insights: TickerInsights }) {
  const i = insights;
  const upside =
    i.targetMean != null && i.currentPrice
      ? ((i.targetMean - i.currentPrice) / i.currentPrice) * 100
      : null;
  const trend = i.recommendationTrend[0];
  const totalRatings = trend
    ? trend.strongBuy + trend.buy + trend.hold + trend.sell + trend.strongSell
    : 0;

  const hasAnalyst =
    i.targetMean != null || i.recommendationKey != null || totalRatings > 0;

  return (
    <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold">Analyst &amp; valuation</h3>
        <span className="text-[11px] text-muted-2">Yahoo · listing currency</span>
      </div>

      {hasAnalyst ? (
        <div className="mb-5 rounded-[10px] border border-border bg-bg/40 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-muted">Mean price target</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[22px] font-semibold tabular-nums">
                  {i.targetMean != null ? formatCurrency(i.targetMean) : "—"}
                </span>
                {upside != null ? (
                  <span
                    className={`text-[13px] font-semibold tabular-nums ${
                      upside >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {formatPercent(upside)} vs price
                  </span>
                ) : null}
              </div>
              {i.targetLow != null && i.targetHigh != null ? (
                <div className="mt-1 text-[12px] text-muted tabular-nums">
                  range {formatCurrency(i.targetLow)} – {formatCurrency(i.targetHigh)}
                  {i.numberOfAnalysts != null ? ` · ${i.numberOfAnalysts} analysts` : ""}
                </div>
              ) : null}
            </div>
            {i.recommendationKey ? (
              <div className="text-right">
                <div className="text-xs font-medium text-muted">Consensus</div>
                <div className="mt-1 text-[15px] font-semibold">
                  {RECO_LABEL[i.recommendationKey] ?? i.recommendationKey}
                  {i.recommendationMean != null ? (
                    <span className="ml-1 text-[12px] font-normal text-muted-2 tabular-nums">
                      ({i.recommendationMean.toFixed(1)}/5)
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {totalRatings > 0 ? (
            <div className="mt-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-bg">
                <Bar n={trend.strongBuy} total={totalRatings} cls="bg-success" />
                <Bar n={trend.buy} total={totalRatings} cls="bg-success/60" />
                <Bar n={trend.hold} total={totalRatings} cls="bg-muted/50" />
                <Bar n={trend.sell} total={totalRatings} cls="bg-danger/60" />
                <Bar n={trend.strongSell} total={totalRatings} cls="bg-danger" />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted tabular-nums">
                <span>{trend.strongBuy + trend.buy} buy</span>
                <span>{trend.hold} hold</span>
                <span>{trend.sell + trend.strongSell} sell</span>
              </div>
            </div>
          ) : null}

          {i.recentActions.length > 0 ? (
            <div className="mt-3 space-y-1 border-t border-border pt-3">
              {i.recentActions.slice(0, 4).map((a, idx) => (
                <div
                  key={`${a.firm}-${idx}`}
                  className="flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="truncate text-text">{a.firm}</span>
                  <span className="shrink-0 text-muted">
                    {a.toGrade ?? a.action ?? "—"}
                    {a.date ? ` · ${a.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
        <Tile label={<><Term>P/E</Term> (TTM)</>} value={ratio(i.trailingPe)} />
        <Tile label="Forward P/E" value={ratio(i.forwardPe)} />
        <Tile label="PEG" value={ratio(i.pegRatio, 2)} />
        <Tile label="EV/EBITDA" value={ratio(i.evToEbitda)} />
        <Tile label="P/B" value={ratio(i.priceToBook)} />
        <Tile label="P/S" value={ratio(i.priceToSales)} />
        <Tile label="Gross margin" value={pct1(i.grossMargin)} />
        <Tile label="Net margin" value={pct1(i.profitMargin)} />
        <Tile label={<Term>ROE</Term>} value={pct1(i.returnOnEquity)} />
        <Tile label="Revenue growth" value={pct1(i.revenueGrowth)} />
        <Tile
          label="Free cash flow"
          value={i.freeCashflow != null ? formatCompactCurrency(i.freeCashflow) : "—"}
        />
        <Tile label="Debt / equity" value={ratio(i.debtToEquity)} />
      </div>

      {i.shortPercentOfFloat != null || i.shortRatio != null ? (
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border pt-4 md:grid-cols-4">
          <Tile label="Short % of float" value={pct1(i.shortPercentOfFloat)} />
          <Tile
            label="Days to cover"
            value={ratio(i.shortRatio)}
            secondary="short ratio"
          />
        </div>
      ) : null}
    </section>
  );
}

function Bar({ n, total, cls }: { n: number; total: number; cls: string }) {
  if (n <= 0) return null;
  return <div className={cls} style={{ width: `${(n / total) * 100}%` }} />;
}

function Tile({
  label,
  value,
  secondary,
}: {
  label: React.ReactNode;
  value: string;
  secondary?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums">{value}</div>
      {secondary ? (
        <div className="text-xs font-medium text-muted-2">{secondary}</div>
      ) : null}
    </div>
  );
}
