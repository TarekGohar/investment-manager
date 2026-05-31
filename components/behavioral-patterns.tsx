import Link from "next/link";
import type { BehavioralReport } from "@/lib/behavioral/patterns";

const KIND_LABEL = {
  PANIC_SELL: "Panic sell",
  FOMO_BUY: "FOMO buy",
  OVERTRADING: "Overtrading",
} as const;

export function BehavioralPatterns({ report }: { report: BehavioralReport }) {
  const allDisabled =
    !report.ranChecks.panicSell &&
    !report.ranChecks.fomoBuy &&
    !report.ranChecks.overtrading;

  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Behavioral patterns</h2>
        <span className="text-xs text-muted">
          {report.flags.length} flag{report.flags.length === 1 ? "" : "s"}
        </span>
      </div>

      {allDisabled ? (
        <div className="border-t border-border bg-warning/5 px-4 py-6 text-sm text-muted md:px-6">
          No behavioral checks are configured. Set thresholds in the IPS
          editor below (e.g. &ldquo;flag any SELL after a -15% move in 5
          days&rdquo;). Nothing is assumed.
        </div>
      ) : (
        <>
          <div className="border-t border-border px-4 py-3 text-xs text-muted md:px-6">
            <span className={check(report.ranChecks.panicSell)}>
              Panic sell
            </span>{" "}
            ·{" "}
            <span className={check(report.ranChecks.fomoBuy)}>FOMO buy</span>{" "}
            ·{" "}
            <span className={check(report.ranChecks.overtrading)}>
              Overtrading
            </span>
          </div>
          {report.flags.length === 0 ? (
            <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
              No flags fired against your configured thresholds. Clean record.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {report.flags.map((f, i) => (
                <FlagRow key={i} flag={f} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function check(on: boolean): string {
  return on ? "text-success" : "text-muted-2 line-through";
}

function FlagRow({ flag }: { flag: BehavioralReport["flags"][number] }) {
  if (flag.kind === "OVERTRADING") {
    return (
      <div className="grid grid-cols-[1fr_2fr_1fr] items-center gap-3 px-4 py-3 md:px-6">
        <div className="text-[14px] font-semibold text-warning">
          {KIND_LABEL[flag.kind]}
        </div>
        <div className="text-[13px] text-muted">
          {flag.tradeCount} trade{flag.tradeCount === 1 ? "" : "s"} in {flag.yearMonth} ·
          threshold {flag.threshold}/mo
        </div>
        <div className="text-right text-xs text-muted-2">{flag.yearMonth}</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[1fr_2fr_1fr] items-center gap-3 px-4 py-3 md:px-6">
      <div>
        <span className="text-[14px] font-semibold text-warning">
          {KIND_LABEL[flag.kind]}
        </span>
        <Link
          href={`/positions/${flag.ticker}`}
          className="ml-2 text-xs font-mono text-muted underline"
        >
          {flag.ticker}
        </Link>
      </div>
      <div className="text-[13px] text-muted">
        {flag.kind === "PANIC_SELL"
          ? `Sold after ${flag.drawdownPct.toFixed(1)}% drawdown over ${flag.drawdownWindowDays} days`
          : `Bought after +${flag.runupPct.toFixed(1)}% runup over ${flag.runupWindowDays} days`}
      </div>
      <div className="text-right text-xs text-muted-2">
        {flag.occurredAt.toLocaleDateString("en-CA", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
    </div>
  );
}
