import Link from "next/link";
import { formatSignedCurrency } from "@/lib/format";
import { Term } from "@/components/term";
import type { AttributionSummary, AttributionRow } from "@/lib/portfolio/attribution";

export function AttributionCard({ summary }: { summary: AttributionSummary }) {
  if (summary.contributors.length === 0 && summary.detractors.length === 0) {
    return null;
  }

  return (
    <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[16px] font-semibold">Performance contributors</h3>
        <span className="text-xs text-muted"><Term>Unrealized</Term> · CAD</span>
      </div>

      {summary.contributors.length > 0 ? (
        <div className="mb-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-success">
            Top contributors
          </div>
          <ul className="space-y-1">
            {summary.contributors.map((r) => (
              <Row key={r.ticker} row={r} tone="up" />
            ))}
          </ul>
        </div>
      ) : null}

      {summary.detractors.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
            Top detractors
          </div>
          <ul className="space-y-1">
            {summary.detractors.map((r) => (
              <Row key={r.ticker} row={r} tone="down" />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-2">
        Contribution = <Term>unrealized</Term> / portfolio <Term>cost basis</Term>. Doesn&apos;t include
        <Term term="Realized P&L"> realized P&amp;L</Term> or dividends — see the top stats for those.
      </div>
    </section>
  );
}

function Row({ row, tone }: { row: AttributionRow; tone: "up" | "down" }) {
  const color = tone === "up" ? "text-success" : "text-danger";
  return (
    <li className="flex items-baseline justify-between gap-3 text-[13px]">
      <Link
        href={`/positions/${row.ticker}`}
        className="font-mono font-semibold hover:underline"
      >
        {row.ticker}
        <span className="ml-1.5 text-[10px] uppercase text-muted-2">{row.currency}</span>
      </Link>
      <div className="flex gap-3 tabular-nums">
        <span className={`${color} font-semibold`}>
          {formatSignedCurrency(row.unrealizedCad)}
        </span>
        <span className="w-12 text-right text-muted">
          {row.returnPct >= 0 ? "+" : ""}
          {row.returnPct.toFixed(1)}%
        </span>
        <span className={`w-14 text-right text-[11px] ${color}`}>
          {row.contributionPct >= 0 ? "+" : ""}
          {row.contributionPct.toFixed(1)}pp
        </span>
      </div>
    </li>
  );
}
