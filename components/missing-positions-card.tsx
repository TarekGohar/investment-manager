import Link from "next/link";
import { Term } from "@/components/term";
import type { MissingPosition } from "@/lib/portfolio/missing-positions";

const KIND_LABEL: Record<string, string> = {
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RESP: "RESP",
  LIRA: "LIRA",
  RRIF: "RRIF",
  NON_REGISTERED: "Non-reg",
  JOINT_NON_REGISTERED: "Joint non-reg",
  CORPORATE: "Corporate",
};

export function MissingPositionsCard({
  positions,
}: {
  positions: MissingPosition[];
}) {
  if (positions.length === 0) return null;
  return (
    <section className="mb-[26px] rounded-card border border-warning/40 bg-warning/5 px-6 py-[22px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-warning">
          {positions.length} position{positions.length === 1 ? "" : "s"} with
          dividends but no recorded opening
        </h3>
        <span className="text-xs text-warning/70">
          RBC DI only exports the last 15 months
        </span>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Your CSV recorded dividends on these positions, but never the original
        purchases — those happened before the export window. To make them show
        up in your portfolio and <Term>ACB</Term> math, record an opening balance for each.
        The quantity hints are parsed from your most recent dividend
        descriptions.
      </p>
      <div className="space-y-1.5">
        {positions.map((p) => {
          const params = new URLSearchParams({
            ticker: p.ticker,
            brokerageId: p.brokerageId,
            kind: "TRANSFER_IN",
          });
          if (p.hintedQuantity != null) {
            params.set("quantity", String(p.hintedQuantity));
          }
          return (
            <Link
              key={`${p.brokerageId}-${p.ticker}`}
              href={`/portfolio?tab=transactions&${params.toString()}`}
              className="flex items-center justify-between gap-3 rounded-[10px] bg-bg/40 px-3 py-2.5 text-sm transition-colors hover:bg-bg/70"
            >
              <div className="min-w-0">
                <span className="font-mono font-semibold">{p.ticker}</span>{" "}
                <span className="text-muted">
                  in {p.brokerageName}{" "}
                  <span className="text-muted-2">
                    ({KIND_LABEL[p.brokerageKind] ?? p.brokerageKind})
                  </span>
                </span>
              </div>
              <div className="shrink-0 text-right text-xs">
                {p.hintedQuantity != null ? (
                  <span className="text-text">
                    Likely <strong>{p.hintedQuantity}</strong> share
                    {p.hintedQuantity === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="text-muted-2">
                    {p.dividendCount} dividends, no share hint
                  </span>
                )}
                <span className="ml-2 text-brand-2">Record →</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
