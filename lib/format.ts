export function formatCurrency(v: number, opts: Intl.NumberFormatOptions = {}) {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
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
