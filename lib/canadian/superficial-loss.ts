import type { Tx } from "@/lib/portfolio/types";
import { isNonRegisteredKind } from "@/lib/portfolio/holdings";

const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 86_400_000;

/**
 * A SELL transaction whose loss is disallowed by CRA's superficial-loss rule:
 * you (or an affiliated person, which we don't model) bought the same or
 * identical security within 30 days before or after the sale.
 *
 * The disallowed loss is not lost — it's added to the ACB of the substituted
 * shares. If you still hold some of the same security right after the sale,
 * those remaining shares absorb the loss. If you fully sold and bought back
 * within 30 days, the new buy absorbs it.
 */
export type SuperficialLossViolation = {
  saleTransactionId: string;
  ticker: string;
  saleDate: Date;
  lossAmount: number; // positive number (absolute value of the disallowed loss)
  /** Conflicting same-ticker BUYs that triggered the rule */
  conflictingBuys: Array<{
    transactionId: string;
    buyDate: Date;
    relationToSale: "before" | "after";
    daysApart: number;
  }>;
  /**
   * Which transaction absorbs the disallowed loss into its cost basis:
   *  - "remaining": loss added to cost basis of shares still held after sale
   *  - "buy:<txId>": loss added to cost basis of the specific BUY (look-forward)
   */
  absorbedBy: { kind: "remaining" } | { kind: "buy"; transactionId: string };
};

/**
 * Active 30-day window from a SELL at a loss that's currently in the no-buyback
 * period. Used to warn users about pending BUYs.
 */
export type ActiveSuperficialLossWindow = {
  ticker: string;
  saleTransactionId: string;
  saleDate: Date;
  lossAmount: number;
  windowEndsAt: Date;
  daysRemaining: number;
};

/**
 * Detect all superficial loss violations across a user's transaction history.
 * Uses ACB derivation to determine if each SELL was at a loss; then scans the
 * 30-day window in both directions for any same-ticker BUY/TRANSFER_IN.
 */
export function detectSuperficialLosses(transactions: Tx[]): SuperficialLossViolation[] {
  // Group per ticker
  const byTicker = new Map<string, Tx[]>();
  for (const tx of transactions) {
    const arr = byTicker.get(tx.ticker) ?? [];
    arr.push(tx);
    byTicker.set(tx.ticker, arr);
  }

  const violations: SuperficialLossViolation[] = [];

  for (const [ticker, txns] of byTicker) {
    const sorted = [...txns].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    // Walk to determine ACB at each SELL.
    let qty = 0;
    let cost = 0;

    for (let i = 0; i < sorted.length; i++) {
      const tx = sorted[i];
      const isNonReg = isNonRegisteredKind(tx.brokerageKind);
      if (!isNonReg) continue; // only non-registered SELLs realize gains/losses

      if (tx.kind === "BUY" || tx.kind === "TRANSFER_IN") {
        const added = tx.quantity * tx.price + (tx.kind === "BUY" ? tx.fees : 0);
        cost += added;
        qty += tx.quantity;
      } else if (tx.kind === "SELL" || tx.kind === "TRANSFER_OUT") {
        if (qty <= 0) continue;
        const acb = cost / qty;
        const proceeds = tx.quantity * tx.price - (tx.kind === "SELL" ? tx.fees : 0);
        const costRemoved = tx.quantity * acb;
        const realized = proceeds - costRemoved;

        // Only SELLs (not TRANSFER_OUT) can realize losses
        if (tx.kind === "SELL" && realized < 0) {
          const violation = checkConflicts(ticker, tx, sorted);
          if (violation) {
            violation.lossAmount = Math.abs(realized);
            // Decide absorption
            const remainingQty = qty - tx.quantity;
            if (remainingQty > 1e-9) {
              violation.absorbedBy = { kind: "remaining" };
            } else {
              // Look for the first BUY/TRANSFER_IN within 30 days after
              const afterBuy = sorted.find(
                (t) =>
                  (t.kind === "BUY" || t.kind === "TRANSFER_IN") &&
                  t.occurredAt > tx.occurredAt &&
                  t.occurredAt.getTime() - tx.occurredAt.getTime() <= WINDOW_MS &&
                  isNonRegisteredKind(t.brokerageKind),
              );
              if (afterBuy) {
                violation.absorbedBy = { kind: "buy", transactionId: afterBuy.id };
              } else {
                // No look-forward absorbing buy; loss is permanently disallowed
                // (rare but possible if all the "conflicting buys" are look-back
                // and the entire position was closed). Fall through to "remaining"
                // even though there's no remainder — treated as informational only.
                violation.absorbedBy = { kind: "remaining" };
              }
            }
            violations.push(violation);
          }
        }

        cost -= costRemoved;
        qty -= tx.quantity;
        if (qty <= 1e-9) {
          qty = 0;
          cost = 0;
        }
      } else if (tx.kind === "SPLIT") {
        const ratio = tx.splitRatio ?? 1;
        if (ratio > 0) qty *= ratio;
        // cost unchanged
      }
    }
  }

  return violations;
}

function checkConflicts(
  ticker: string,
  saleTx: Tx,
  allSameTicker: Tx[],
): SuperficialLossViolation | null {
  const saleDate = saleTx.occurredAt;
  const lookBackStart = new Date(saleDate.getTime() - WINDOW_MS);
  const lookForwardEnd = new Date(saleDate.getTime() + WINDOW_MS);

  const conflictingBuys: SuperficialLossViolation["conflictingBuys"] = [];
  for (const other of allSameTicker) {
    if (other.id === saleTx.id) continue;
    if (other.kind !== "BUY" && other.kind !== "TRANSFER_IN") continue;
    if (!isNonRegisteredKind(other.brokerageKind)) continue;
    const otherTime = other.occurredAt.getTime();
    if (otherTime >= lookBackStart.getTime() && otherTime < saleDate.getTime()) {
      conflictingBuys.push({
        transactionId: other.id,
        buyDate: other.occurredAt,
        relationToSale: "before",
        daysApart: Math.round((saleDate.getTime() - otherTime) / 86_400_000),
      });
    }
    if (otherTime > saleDate.getTime() && otherTime <= lookForwardEnd.getTime()) {
      conflictingBuys.push({
        transactionId: other.id,
        buyDate: other.occurredAt,
        relationToSale: "after",
        daysApart: Math.round((otherTime - saleDate.getTime()) / 86_400_000),
      });
    }
  }

  if (conflictingBuys.length === 0) return null;

  return {
    saleTransactionId: saleTx.id,
    ticker,
    saleDate,
    lossAmount: 0, // filled in by caller
    conflictingBuys,
    absorbedBy: { kind: "remaining" }, // overwritten by caller
  };
}

/**
 * Active superficial-loss windows — SELL at a loss in the last 30 days, with
 * the window still open. Use these to warn about pending BUYs.
 */
export function getActiveSuperficialLossWindows(
  transactions: Tx[],
  now: Date = new Date(),
): ActiveSuperficialLossWindow[] {
  // For active windows we want sales WITHIN the last 30 days that were at a loss
  // and where no BUY has yet happened to absorb (or where another BUY would still
  // trigger).
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const windows: ActiveSuperficialLossWindow[] = [];

  const byTicker = new Map<string, Tx[]>();
  for (const tx of transactions) {
    if (tx.kind !== "SELL") continue;
    if (!isNonRegisteredKind(tx.brokerageKind)) continue;
    if (tx.occurredAt < cutoff) continue;
    const arr = byTicker.get(tx.ticker) ?? [];
    arr.push(tx);
    byTicker.set(tx.ticker, arr);
  }

  // Determine loss for each recent SELL by walking full history per ticker
  for (const [ticker, recentSales] of byTicker) {
    const allForTicker = transactions
      .filter((t) => t.ticker === ticker)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    for (const sale of recentSales) {
      // Walk up to this sale to compute ACB
      let qty = 0;
      let cost = 0;
      for (const t of allForTicker) {
        if (t.occurredAt >= sale.occurredAt) break;
        if (!isNonRegisteredKind(t.brokerageKind)) continue;
        if (t.kind === "BUY" || t.kind === "TRANSFER_IN") {
          cost += t.quantity * t.price + (t.kind === "BUY" ? t.fees : 0);
          qty += t.quantity;
        } else if (t.kind === "SELL" || t.kind === "TRANSFER_OUT") {
          if (qty > 0) {
            const acb = cost / qty;
            cost -= t.quantity * acb;
            qty -= t.quantity;
          }
          if (qty < 1e-9) {
            qty = 0;
            cost = 0;
          }
        } else if (t.kind === "SPLIT") {
          const ratio = t.splitRatio ?? 1;
          if (ratio > 0) qty *= ratio;
        }
      }
      if (qty <= 0) continue;
      const acb = cost / qty;
      const proceeds = sale.quantity * sale.price - sale.fees;
      const realized = proceeds - sale.quantity * acb;
      if (realized >= 0) continue;

      const windowEndsAt = new Date(sale.occurredAt.getTime() + WINDOW_MS);
      if (windowEndsAt < now) continue;

      windows.push({
        ticker,
        saleTransactionId: sale.id,
        saleDate: sale.occurredAt,
        lossAmount: Math.abs(realized),
        windowEndsAt,
        daysRemaining: Math.max(
          0,
          Math.ceil((windowEndsAt.getTime() - now.getTime()) / 86_400_000),
        ),
      });
    }
  }

  return windows.sort((a, b) => b.lossAmount - a.lossAmount);
}

/**
 * Check whether a proposed BUY at a given date for a given ticker would
 * trigger a superficial loss against any recent SELL at a loss. Used by the
 * transaction form for pre-trade warnings.
 */
export function wouldCreateSuperficialLoss(
  ticker: string,
  proposedDate: Date,
  transactions: Tx[],
): { violates: boolean; sale?: ActiveSuperficialLossWindow } {
  const sym = ticker.toUpperCase();
  const windows = getActiveSuperficialLossWindows(transactions, proposedDate);
  const conflict = windows.find(
    (w) => w.ticker === sym && proposedDate <= w.windowEndsAt,
  );
  if (!conflict) return { violates: false };
  // Also check look-back: is the proposed BUY date within 30 days OF the sale?
  const within = proposedDate.getTime() - conflict.saleDate.getTime() <= WINDOW_MS;
  if (!within) return { violates: false };
  return { violates: true, sale: conflict };
}
