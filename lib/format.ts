/**
 * Adaptive currency formatter:
 *   |v| >= 1     → 2 decimals      ($1,234.56, $5.00)
 *   |v| >= 0.01  → up to 4         ($0.075, $0.0125)
 *   |v| < 0.01   → up to 6         ($0.000750)
 *
 * Penny stocks and many CSE listings trade at fractional cents — losing
 * those digits hides real price movement. `minimumFractionDigits: 2`
 * keeps round-dollar amounts looking clean.
 */
export function formatCurrency(v: number, opts: Intl.NumberFormatOptions = {}) {
  const abs = Math.abs(v);
  const adaptiveMax = abs === 0 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: adaptiveMax,
    ...opts,
  });
}

export function formatPercent(v: number, fractionDigits = 2) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(fractionDigits)}%`;
}

export function formatSignedCurrency(v: number) {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}${formatCurrency(Math.abs(v))}`;
}

export function formatCompact(v: number) {
  return v.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

export function formatCompactCurrency(v: number) {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

export function formatQty(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
