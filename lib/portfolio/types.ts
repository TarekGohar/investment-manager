import type { TransactionKind } from "@/generated/prisma";

export type Tx = {
  id: string;
  brokerageId: string;
  ticker: string;
  kind: TransactionKind;
  quantity: number;
  price: number;
  fees: number;
  occurredAt: Date;
  note: string | null;
  splitRatio: number | null;
};

export type Holding = {
  ticker: string;
  quantity: number;
  avgCost: number;
  costBasis: number;
  openedAt: Date;
  realizedGain: number;
  totalDividends: number;
};

export type PortfolioSummary = {
  holdings: Holding[];
  totalCost: number;
  totalRealized: number;
  totalDividends: number;
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
  quoteAsOf: Date | null;
  hasAnyQuote: boolean;
};
