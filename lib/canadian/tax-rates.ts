/**
 * Tax-rate helpers. All functions require an explicit marginal rate — never
 * guessed. If the caller doesn't have a user-supplied rate, it must either
 * prompt for one or skip the dollar estimate entirely. See
 * `feedback_no_assumed_numbers` in memory: hard-coded brackets bake invisible
 * incorrectness into TLH sizing and after-tax math.
 *
 * `QC_TOP_MARGINAL_RATES_REFERENCE` exists only as a non-authoritative hint
 * the settings UI may show as placeholder text. It must not be imported as a
 * runtime default by any active code path.
 *
 * Combined federal + Quebec marginal rates from CRA 2025 + Revenu Québec 2025
 * brackets — widely-cited combined top-bracket numbers, but not exact for
 * every income level.
 */

export const QC_TOP_MARGINAL_RATES_REFERENCE = {
  ordinaryIncome: 0.5331,
  capitalGains: 0.2665,
  eligibleDividend: 0.4011,
  /**
   * 0.4870 per current EY / KPMG / Revenu Québec 2025 personal-tax
   * calculators (previously 0.4827, which was a stale reference).
   */
  nonEligibleDividend: 0.4870,
} as const;

/** Canadian capital-gains inclusion rate. Statutory, not a personal number. */
export const CAPITAL_GAINS_INCLUSION_RATE = 0.5;

/**
 * Dollar tax saving from realizing a capital loss at the user's marginal
 * cap-gains rate. The rate must already be the *combined* effective rate on
 * a dollar of taxable capital gain (i.e. it already bakes in the 50%
 * inclusion). Pass the value from `TaxProfile.marginalCapGainsRate`.
 */
export function capitalLossTaxSaving(
  lossAmount: number,
  capGainsRate: number,
): number {
  return Math.abs(lossAmount) * capGainsRate;
}

/** After-tax value of an eligible dividend at the user's eligible-div rate. */
export function afterTaxEligibleDividend(
  grossDividend: number,
  eligibleDividendRate: number,
): number {
  return grossDividend * (1 - eligibleDividendRate);
}

/** After-tax value of ordinary income (e.g. RRSP withdrawal) at the user's rate. */
export function afterTaxOrdinaryIncome(
  amount: number,
  ordinaryRate: number,
): number {
  return amount * (1 - ordinaryRate);
}

/**
 * TLH sizing helper. Returns the dollar saving at the supplied cap-gains
 * rate, plus the inclusion-adjusted taxable loss. Returns null when no rate
 * is supplied — callers must surface a "set your marginal rate" CTA rather
 * than render a misleading estimate.
 */
export function tlhTaxSaving(
  lossAmount: number,
  capGainsRate: number | null,
): { saving: number; taxableLoss: number; rate: number } | null {
  if (capGainsRate == null) return null;
  const absLoss = Math.abs(lossAmount);
  return {
    saving: absLoss * capGainsRate,
    taxableLoss: absLoss * CAPITAL_GAINS_INCLUSION_RATE,
    rate: capGainsRate,
  };
}
