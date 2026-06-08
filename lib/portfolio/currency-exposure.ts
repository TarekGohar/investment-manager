import "server-only";
import type { EnrichedPortfolio } from "./types";
import type { CashSummary } from "./cash";

/**
 * Currency exposure breakdown. For a Canadian investor whose accounts
 * report in CAD, holdings in USD (or any non-CAD currency) carry FX risk
 * on top of equity risk: a stronger CAD shrinks the CAD-equivalent value
 * of those positions even if the underlying stock price doesn't move.
 *
 * The "sensitivity" line answers: if CAD/USD moves by 1¢, how much does
 * my portfolio CAD value change?
 */
export type CurrencyExposureRow = {
  currency: string;
  /** Total CAD value of all assets + cash denominated in this currency. */
  valueCad: number;
  /** Native-currency total (assets + cash). */
  valueNative: number;
  /** Percentage of total portfolio NAV (CAD). */
  pctOfNav: number;
  /** USD/CAD or equivalent rate used for the CAD conversion. 1 for CAD. */
  fxRate: number;
  /** Per-source breakdown for the card display. */
  assetsCad: number;
  cashCad: number;
};

export type CurrencyExposureSummary = {
  rows: CurrencyExposureRow[];
  totalNavCad: number;
  /**
   * CAD impact of a 1-cent move in CAD/USD (e.g. 1.38 → 1.39). Positive
   * means CAD weakens helps the portfolio (you hold USD-denominated assets).
   * Computed as: sum of native USD exposure × 0.01.
   */
  oneCentUsdMoveImpactCad: number;
  /** Same shape for any other non-CAD currency the user holds. */
  oneCentImpactByCurrency: Record<string, number>;
};

export function computeCurrencyExposure(args: {
  portfolio: EnrichedPortfolio;
  cash: CashSummary;
  usdToCadRate: number | null;
}): CurrencyExposureSummary {
  const byCurrency = new Map<
    string,
    { assetsCad: number; cashCad: number; native: number; fxRate: number }
  >();

  // Holdings (assets) — bucket by `listingCurrency` (the exchange the stock
  // trades on), NOT `currency` (the accounting currency the cost basis is
  // booked in). A US stock held in a Canadian registered account with a
  // CAD-booked basis still carries USD FX exposure on its market value;
  // accounting currency hides that. `marketValueCad` is already in CAD via
  // the enrichment layer; the native amount is derived by dividing back out
  // by the listing-currency FX rate so the 1¢ sensitivity is correct.
  for (const h of args.portfolio.holdings) {
    const ccy = h.listingCurrency || h.currency || "CAD";
    const fx = fxRateFor(ccy, args.usdToCadRate);
    const row = byCurrency.get(ccy) ?? {
      assetsCad: 0,
      cashCad: 0,
      native: 0,
      fxRate: fx,
    };
    const mvCad = h.marketValueCad ?? h.costBasisCad;
    const mvNative = ccy === "CAD" ? mvCad : fx > 0 ? mvCad / fx : 0;
    row.assetsCad += mvCad;
    row.native += mvNative;
    byCurrency.set(ccy, row);
  }

  // Cash — already grouped by currency
  for (const [ccy, amount] of Object.entries(args.cash.totalsByCurrency)) {
    if (Math.abs(amount) < 0.005) continue;
    const fx = fxRateFor(ccy, args.usdToCadRate);
    const cashCad = amount * fx;
    const row = byCurrency.get(ccy) ?? {
      assetsCad: 0,
      cashCad: 0,
      native: 0,
      fxRate: fx,
    };
    row.cashCad += cashCad;
    row.native += amount;
    byCurrency.set(ccy, row);
  }

  const totalNavCad = Array.from(byCurrency.values()).reduce(
    (s, r) => s + r.assetsCad + r.cashCad,
    0,
  );

  const rows: CurrencyExposureRow[] = Array.from(byCurrency.entries())
    .map(([currency, r]) => ({
      currency,
      valueCad: r.assetsCad + r.cashCad,
      valueNative: r.native,
      pctOfNav: totalNavCad > 0 ? ((r.assetsCad + r.cashCad) / totalNavCad) * 100 : 0,
      fxRate: r.fxRate,
      assetsCad: r.assetsCad,
      cashCad: r.cashCad,
    }))
    .sort((a, b) => b.valueCad - a.valueCad);

  // 1¢ sensitivity: a $0.01 move in the FX pair times native exposure
  // gives the CAD-value swing. Caller renders this as a "per cent move"
  // line on the card.
  const oneCentImpactByCurrency: Record<string, number> = {};
  for (const row of rows) {
    if (row.currency === "CAD") continue;
    oneCentImpactByCurrency[row.currency] = row.valueNative * 0.01;
  }
  const oneCentUsdMoveImpactCad = oneCentImpactByCurrency["USD"] ?? 0;

  return {
    rows,
    totalNavCad,
    oneCentUsdMoveImpactCad,
    oneCentImpactByCurrency,
  };
}

function fxRateFor(currency: string, usdToCadRate: number | null): number {
  if (currency === "CAD") return 1;
  if (currency === "USD") return usdToCadRate ?? 1;
  // For other currencies the enrichment layer doesn't FX today; treat as 1
  // until we wire the rest. computeCurrencyExposure consumes
  // marketValueCad which already encodes whatever rate the queries used.
  return 1;
}
