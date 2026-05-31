import type { BrokerageKind, TransactionKind } from "@/generated/prisma";

export type Tx = {
  id: string;
  brokerageId: string;
  brokerageKind: BrokerageKind;
  ticker: string;
  kind: TransactionKind;
  quantity: number;
  price: number;
  fees: number;
  foreignTaxWithheld: number;
  occurredAt: Date;
  note: string | null;
  splitRatio: number | null;
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
  marketPrice: number | null;
  marketValue: number | null;
  unrealized: number | null;
  unrealizedPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
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
