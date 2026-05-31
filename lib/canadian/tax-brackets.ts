/**
 * Canadian tax bracket tables and marginal-rate computation.
 *
 * Used by the tax-profile wizard to *derive* marginal rates from the user's
 * taxable income — not to assume them. The user supplies income; we look
 * up which bracket they're in and compute the combined federal + provincial
 * marginal rate including the Quebec abatement and dividend tax credits.
 *
 * Brackets are 2025 (the most recent year with finalized values). The
 * wizard surfaces the year used so the user can override when filing for
 * a different year.
 */

export const TAX_YEAR = 2025;

type Bracket = { upTo: number; rate: number };

// Federal brackets — 2025
const FEDERAL_BRACKETS: Bracket[] = [
  { upTo: 57_375, rate: 0.15 },
  { upTo: 114_750, rate: 0.205 },
  { upTo: 177_882, rate: 0.26 },
  { upTo: 253_414, rate: 0.29 },
  { upTo: Infinity, rate: 0.33 },
];

// Quebec brackets — 2025
const QUEBEC_BRACKETS: Bracket[] = [
  { upTo: 53_255, rate: 0.14 },
  { upTo: 106_495, rate: 0.19 },
  { upTo: 129_590, rate: 0.24 },
  { upTo: Infinity, rate: 0.2575 },
];

// Quebec residents receive a 16.5% abatement on federal tax (Quebec
// administers part of the federal income tax collection itself).
const QC_ABATEMENT = 0.165;

// Dividend gross-up / tax credit rates (federal + Quebec, 2025)
const ELIGIBLE_GROSS_UP = 0.38;
const NON_ELIGIBLE_GROSS_UP = 0.15;
const FED_DTC_ELIGIBLE = 0.150198; // 15.0198% of grossed-up amount
const FED_DTC_NON_ELIGIBLE = 0.090301; // 9.0301% of grossed-up amount
const QC_DTC_ELIGIBLE = 0.117; // 11.70% of grossed-up amount
const QC_DTC_NON_ELIGIBLE = 0.0342; // 3.42% of grossed-up amount

const CAPITAL_GAINS_INCLUSION = 0.5;

function marginalRate(brackets: Bracket[], income: number): number {
  for (const b of brackets) {
    if (income <= b.upTo) return b.rate;
  }
  return brackets[brackets.length - 1].rate;
}

export type ComputedRates = {
  marginalOrdinaryRate: number;
  marginalCapGainsRate: number;
  marginalEligibleDividendRate: number;
  marginalNonEligibleDividendRate: number;
  /** The federal + provincial marginal rates that went into the computation. */
  breakdown: {
    federalRate: number;
    provincialRate: number;
    quebecAbatement: number;
  };
};

/**
 * Compute combined federal + Quebec marginal tax rates at the user's
 * supplied taxable income. Quebec only — other provinces fall back to
 * "wizard not available" in the UI.
 *
 * Math:
 *   Ordinary: fed × (1 - 16.5%) + QC
 *   Cap gains: ordinary × 50% inclusion
 *   Dividends: (grossed_up × ordinary) - DTCs
 */
export function computeQuebecRates(taxableIncome: number): ComputedRates {
  const fed = marginalRate(FEDERAL_BRACKETS, taxableIncome);
  const qc = marginalRate(QUEBEC_BRACKETS, taxableIncome);
  const effectiveFed = fed * (1 - QC_ABATEMENT);
  const ordinary = effectiveFed + qc;

  // Eligible dividends
  const eligibleGrossed = 1 + ELIGIBLE_GROSS_UP;
  const eligibleTax =
    eligibleGrossed * effectiveFed +
    eligibleGrossed * qc -
    eligibleGrossed * FED_DTC_ELIGIBLE * (1 - QC_ABATEMENT) -
    eligibleGrossed * QC_DTC_ELIGIBLE;
  const eligibleRate = Math.max(0, eligibleTax);

  // Non-eligible dividends
  const nonEligibleGrossed = 1 + NON_ELIGIBLE_GROSS_UP;
  const nonEligibleTax =
    nonEligibleGrossed * effectiveFed +
    nonEligibleGrossed * qc -
    nonEligibleGrossed * FED_DTC_NON_ELIGIBLE * (1 - QC_ABATEMENT) -
    nonEligibleGrossed * QC_DTC_NON_ELIGIBLE;
  const nonEligibleRate = Math.max(0, nonEligibleTax);

  return {
    marginalOrdinaryRate: ordinary,
    marginalCapGainsRate: ordinary * CAPITAL_GAINS_INCLUSION,
    marginalEligibleDividendRate: eligibleRate,
    marginalNonEligibleDividendRate: nonEligibleRate,
    breakdown: {
      federalRate: fed,
      provincialRate: qc,
      quebecAbatement: QC_ABATEMENT,
    },
  };
}

/** Province codes the wizard can derive rates for. */
export const WIZARD_SUPPORTED_PROVINCES = ["QC"] as const;
export type WizardProvince = (typeof WIZARD_SUPPORTED_PROVINCES)[number];

export function isWizardSupported(province: string): province is WizardProvince {
  return (WIZARD_SUPPORTED_PROVINCES as readonly string[]).includes(province);
}

/**
 * Friendly bracket boundaries to show the user so they can see *why* their
 * marginal rate is what it is. Quebec only for now.
 */
export const QC_COMBINED_BRACKETS_DISPLAY = [
  { upTo: 53_255, label: "Up to $53,255" },
  { upTo: 57_375, label: "$53,255 – $57,375" },
  { upTo: 106_495, label: "$57,375 – $106,495" },
  { upTo: 114_750, label: "$106,495 – $114,750" },
  { upTo: 129_590, label: "$114,750 – $129,590" },
  { upTo: 177_882, label: "$129,590 – $177,882" },
  { upTo: 253_414, label: "$177,882 – $253,414" },
  { upTo: Infinity, label: "$253,414+" },
];

export function quebecBracketLabel(income: number): string {
  for (const b of QC_COMBINED_BRACKETS_DISPLAY) {
    if (income <= b.upTo) return b.label;
  }
  return QC_COMBINED_BRACKETS_DISPLAY[QC_COMBINED_BRACKETS_DISPLAY.length - 1].label;
}
