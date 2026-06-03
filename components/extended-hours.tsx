import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";
import type { MarketState } from "@/lib/marketdata";

/** Human label for an extended-hours session, or null during regular/closed. */
export function extendedSessionLabel(
  state: MarketState | null | undefined,
): string | null {
  if (state === "PRE" || state === "PREPRE") return "Pre-market";
  if (state === "POST" || state === "POSTPOST") return "After-hours";
  return null;
}

/**
 * Small inline pre-market / after-hours readout, shown next to the regular
 * price. Renders nothing outside extended hours or when no extended price is
 * available. Presentational only, so it works in both server and client trees.
 */
export function ExtendedHoursNote({
  marketState,
  price,
  change,
  changePct,
  size = "md",
  className = "",
}: {
  marketState: MarketState | null | undefined;
  price: number | null | undefined;
  change: number | null | undefined;
  changePct: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const label = extendedSessionLabel(marketState);
  if (!label || price == null) return null;

  const up = (changePct ?? change ?? 0) >= 0;
  const text = size === "sm" ? "text-[11px]" : "text-[13px]";

  return (
    <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${text} ${className}`}>
      <span className="rounded-full bg-pill px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="font-semibold tabular-nums text-text">{formatCurrency(price)}</span>
      <span className={`font-medium tabular-nums ${up ? "text-success" : "text-danger"}`}>
        {formatSignedCurrency(change ?? 0)}
        {changePct != null ? ` (${formatPercent(changePct)})` : ""}
      </span>
    </div>
  );
}
