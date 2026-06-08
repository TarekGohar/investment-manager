import type {
  BrokerageKind,
  DividendType,
  SellReason,
  TransactionKind,
} from "@/generated/prisma";

export type Tx = {
  id: string;
  brokerageId: string;
  brokerageKind: BrokerageKind;
  /** Null for cash flows (DEPOSIT / WITHDRAWAL). */
  ticker: string | null;
  kind: TransactionKind;
  /** Currency of all amount fields in this row. Defaulted from brokerage at write time. */
  currency: string;
  /** CAD-equivalent FX rate at trade date. Null when currency = CAD. */
  fxRateToCad: number | null;
  quantity: number;
  price: number;
  fees: number;
  foreignTaxWithheld: number;
  dividendType: DividendType | null;
  /** Required for SELL; null otherwise. */
  reasonCode: SellReason | null;
  /** True for BUY rows that represent a dividend reinvestment inside a registered account. */
  isDrip: boolean;
  /** For CORPORATE_ACTION rows. See schema doc for payload shape. */
  corporateActionPayload: CorporateActionPayload | null;
  /** For GIC/bond rows; informational only. */
  maturesAt: Date | null;
  occurredAt: Date;
  note: string | null;
  splitRatio: number | null;
};

export type CorporateActionEvent = "SPINOFF" | "MERGER" | "NAME_CHANGE" | "REDENOMINATION";

export type CorporateActionLeg = {
  ticker: string;
  /**
   * For SPINOFF: shares of `ticker` received per existing share of the
   * parent (e.g. WBD spinoff from T at ratio 0.241917).
   * For MERGER / NAME_CHANGE / REDENOMINATION: ratio of new shares per old.
   */
  ratio: number;
  /**
   * Percentage of the parent's pre-action cost basis that flows to this
   * leg (0–100). Sum across legs ≤ 100; remainder stays with the parent
   * ticker (cash-in-lieu is recorded separately as a DIVIDEND OTHER).
   */
  basisAllocationPct: number;
};

export type CorporateActionPayload = {
  event: CorporateActionEvent;
  legs: CorporateActionLeg[];
  notes?: string | null;
};

/**
 * A single position derived from the transaction ledger. Canadian-flavored:
 *
 * - `acb` is the per-share Adjusted Cost Base for the **non-registered pool**
 *   of this ticker. CRA-relevant.
 * - `nonRegQuantity` / `nonRegCostBasis` = ACB-tracked portion
 * - `registeredQuantity` / `registeredCostBasis` = informational (no tax)
 * - `quantity` / `costBasis` are the totals across all account types
 * - `realizedGain` accumulates only from non-registered sells; the rest is
 *   tax-free (TFSA/FHSA) or tax-deferred (RRSP/LIRA/RRIF)
 */
export type Holding = {
  ticker: string;
  /**
   * Display / accounting currency for this holding's cost basis. Captured
   * from the first share-affecting tx (BUY / TRANSFER_IN). This is the
   * currency that `costBasis`, `marketValue`, dividends, etc. are
   * denominated in. CRA-relevant: for non-registered ACB this is the
   * currency the basis is reported in for taxes.
   */
  currency: string;
  /**
   * The security's home-exchange currency — USD for naked tickers, CAD for
   * .TO/.V/.NE/.CN. Distinct from `currency` above for positions whose
   * accounting was booked in CAD even though the underlying trades in USD
   * (e.g. a US stock held in a Canadian registered account where the
   * broker reports CAD-equivalent values). This is the field downstream
   * FX-exposure code should bucket on.
   */
  listingCurrency: string;
  // Totals (used by display + AI summaries)
  quantity: number;
  costBasis: number;
  // Non-registered (the ACB pool that matters for tax)
  nonRegQuantity: number;
  nonRegCostBasis: number;
  acb: number;
  realizedGain: number;
  totalForeignTaxWithheld: number;
  // Registered (TFSA/RRSP/FHSA/RESP/LIRA/RRIF) — money invested, no ACB
  registeredQuantity: number;
  registeredCostBasis: number;
  // Always
  openedAt: Date;
  totalDividends: number;
  // Per-account-kind breakdown (for asset-location work in Session 2)
  byKind: Record<BrokerageKind, AccountSliceSummary>;
};

export type AccountSliceSummary = {
  quantity: number;
  costBasis: number; // ACB for non-reg pools; sum of buys for registered
};

export type PortfolioSummary = {
  holdings: Holding[];
  totalCost: number;
  totalRealized: number;
  totalDividends: number;
  totalForeignTaxWithheld: number;
};

export type EnrichedHolding = Holding & {
  /** Per-share price in the holding's native currency. */
  marketPrice: number | null;
  /** Market value in the holding's native currency. */
  marketValue: number | null;
  /** Unrealized P&L in the holding's native currency. */
  unrealized: number | null;
  unrealizedPct: number | null;
  /** Day change in the holding's native currency (for the whole position). */
  dayChange: number | null;
  dayChangePct: number | null;
  /** Cost basis in CAD-equivalent (today's FX). Used for portfolio weights
   *  and any cross-currency comparison. */
  costBasisCad: number;
  /** Market value in CAD-equivalent (today's FX). */
  marketValueCad: number | null;
  /** Unrealized in CAD-equivalent. */
  unrealizedCad: number | null;
  quoteAsOf: Date | null;
};

export type EnrichedPortfolio = {
  holdings: EnrichedHolding[];
  totalCost: number;
  totalMarketValue: number;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  totalDayChange: number;
  totalDayChangePct: number;
  totalRealized: number;
  totalDividends: number;
  totalForeignTaxWithheld: number;
  quoteAsOf: Date | null;
  hasAnyQuote: boolean;
};
