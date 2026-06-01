import { formatCurrency } from "@/lib/format";

export function NetWorthCard({
  assetsCad,
  cashCad,
  cashByCurrency,
}: {
  assetsCad: number;
  cashCad: number;
  /** Raw per-currency cash totals before FX, for the breakdown line. */
  cashByCurrency: Record<string, number>;
}) {
  const total = assetsCad + cashCad;
  const cashCurrencies = Object.entries(cashByCurrency)
    .filter(([, v]) => Math.abs(v) > 0.005)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  return (
    <section className="mb-[26px] rounded-card border border-brand/40 bg-gradient-to-br from-brand/10 to-brand-3/5 px-6 py-[24px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            Total portfolio value (CAD)
          </div>
          <div className="mt-1 text-[34px] font-semibold leading-tight tabular-nums">
            {formatCurrency(total)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6 text-right">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">
              Assets
            </div>
            <div className="text-[18px] font-semibold tabular-nums">
              {formatCurrency(assetsCad)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">
              Cash
            </div>
            <div className="text-[18px] font-semibold tabular-nums">
              {formatCurrency(cashCad)}
            </div>
            {cashCurrencies.length > 0 ? (
              <div className="mt-0.5 text-[10px] text-muted-2">
                {cashCurrencies
                  .map(([ccy, amt]) => `${formatCurrency(amt)} ${ccy}`)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
