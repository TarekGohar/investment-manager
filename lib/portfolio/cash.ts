import "server-only";
import { prisma } from "@/lib/prisma";
import type { BrokerageKind } from "@/generated/prisma";
import type { Tx } from "./types";

export type CashFlowItem = {
  date: Date;
  brokerageId: string;
  ticker: string | null;
  kind: Tx["kind"];
  /** Signed: positive = cash in to the brokerage, negative = cash out. */
  delta: number;
  note: string | null;
};

export type CashBalance = {
  brokerageId: string;
  brokerageName: string;
  brokerageKind: BrokerageKind;
  currency: string;
  /** Net cash currently sitting in the account. */
  balance: number;
  /** Lifetime cash deposited externally (DEPOSIT only). */
  totalDeposits: number;
  /** Lifetime cash withdrawn externally (WITHDRAWAL only). */
  totalWithdrawals: number;
  /** Lifetime dividends + sell proceeds + interest, etc. */
  totalInternalInflow: number;
  /** Lifetime buys + fees. */
  totalInternalOutflow: number;
};

/**
 * Per-transaction cash impact on the brokerage holding that transaction.
 *
 * Sign convention: positive = cash credited to the account, negative = cash
 * debited. SPLIT and TRANSFER_IN / TRANSFER_OUT are zero — transfers carry
 * shares, not cash. If you actually paid for the transferred shares, record
 * a separate DEPOSIT.
 */
export function cashDeltaForTx(tx: Tx): number {
  switch (tx.kind) {
    case "DEPOSIT":
      // Convention: amount stored in `price`, quantity = 1.
      return tx.price;
    case "WITHDRAWAL":
      return -tx.price;
    case "BUY":
      return -(tx.quantity * tx.price + tx.fees);
    case "SELL":
      return tx.quantity * tx.price - tx.fees;
    case "DIVIDEND":
      // `price` holds the gross dividend; FWT is withheld at source so the
      // amount actually credited to the cash account is net of FWT.
      return tx.price - tx.foreignTaxWithheld;
    case "SPLIT":
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return 0;
  }
}

/**
 * Aggregate cash balance per brokerage. Walks the user's whole transaction
 * history; brokerages with no transactions still appear with a balance of 0.
 */
export async function getCashBalances(userId: string): Promise<CashBalance[]> {
  const [brokerages, transactions] = await Promise.all([
    prisma.brokerage.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, kind: true, currency: true },
    }),
    prisma.transaction.findMany({
      where: { userId },
      select: {
        brokerageId: true,
        kind: true,
        quantity: true,
        price: true,
        fees: true,
        foreignTaxWithheld: true,
      },
    }),
  ]);

  type Accum = {
    balance: number;
    deposits: number;
    withdrawals: number;
    internalIn: number;
    internalOut: number;
  };
  const acc = new Map<string, Accum>();
  for (const b of brokerages) {
    acc.set(b.id, { balance: 0, deposits: 0, withdrawals: 0, internalIn: 0, internalOut: 0 });
  }

  for (const t of transactions) {
    const a = acc.get(t.brokerageId);
    if (!a) continue;
    const delta = cashDeltaForTx({
      // Only the fields cashDeltaForTx reads are populated.
      id: "",
      brokerageId: t.brokerageId,
      brokerageKind: "NON_REGISTERED",
      ticker: "",
      kind: t.kind,
      quantity: t.quantity.toNumber(),
      price: t.price.toNumber(),
      fees: t.fees.toNumber(),
      foreignTaxWithheld: t.foreignTaxWithheld ? t.foreignTaxWithheld.toNumber() : 0,
      occurredAt: new Date(),
      note: null,
      splitRatio: null,
    });
    a.balance += delta;
    if (t.kind === "DEPOSIT") a.deposits += delta;
    else if (t.kind === "WITHDRAWAL") a.withdrawals += Math.abs(delta);
    else if (delta > 0) a.internalIn += delta;
    else if (delta < 0) a.internalOut += Math.abs(delta);
  }

  return brokerages.map((b): CashBalance => {
    const a = acc.get(b.id)!;
    return {
      brokerageId: b.id,
      brokerageName: b.name,
      brokerageKind: b.kind,
      currency: b.currency,
      balance: a.balance,
      totalDeposits: a.deposits,
      totalWithdrawals: a.withdrawals,
      totalInternalInflow: a.internalIn,
      totalInternalOutflow: a.internalOut,
    };
  });
}

export type CashSummary = {
  /** Net cash across all brokerages, in their reported currencies (no FX). */
  totalsByCurrency: Record<string, number>;
  /** Lifetime sums across all brokerages, by currency. */
  totalDepositsByCurrency: Record<string, number>;
  totalWithdrawalsByCurrency: Record<string, number>;
  byBrokerage: CashBalance[];
};

export function summarizeCash(balances: CashBalance[]): CashSummary {
  const totals: Record<string, number> = {};
  const dep: Record<string, number> = {};
  const wd: Record<string, number> = {};
  for (const b of balances) {
    totals[b.currency] = (totals[b.currency] ?? 0) + b.balance;
    dep[b.currency] = (dep[b.currency] ?? 0) + b.totalDeposits;
    wd[b.currency] = (wd[b.currency] ?? 0) + b.totalWithdrawals;
  }
  return {
    totalsByCurrency: totals,
    totalDepositsByCurrency: dep,
    totalWithdrawalsByCurrency: wd,
    byBrokerage: balances,
  };
}
