import type { BrokerageKind } from "@/generated/prisma";
import type {
  AccountSliceSummary,
  Holding,
  PortfolioSummary,
  Tx,
} from "./types";
import { detectSuperficialLosses } from "@/lib/canadian/superficial-loss";
import { expandCorporateActions } from "./corporate-actions";

/**
 * Canadian ACB-aware holding derivation.
 *
 * For NON_REGISTERED + JOINT_NON_REGISTERED brokerages (the "ACB pool"):
 *   - BUYs: weighted-average ACB recomputed. fees fold into cost basis.
 *   - SELLs: per-share ACB stays constant. Realized gain = proceeds - fees - qty * ACB.
 *   - SPLITs: qty * ratio; per-share ACB / ratio. Total cost basis unchanged.
 *
 * For registered brokerages (TFSA / RRSP / FHSA / RESP / LIRA / RRIF):
 *   - No ACB tracking, no realized gain (tax-free or tax-deferred at this level)
 *   - Track running qty + money-invested for display only
 *
 * Returns one row per ticker, with non-reg and registered breakdowns plus
 * a per-kind `byKind` slice so downstream code (asset location, tax view)
 * can show how a position is distributed across account types.
 */
export function deriveHoldings(transactions: Tx[]): Holding[] {
  // Pass 0: expand CORPORATE_ACTION rows into synthetic child-ticker
  // TRANSFER_IN rows (spinoffs / mergers / name changes). The originals
  // remain in the stream so the parent ticker's iteration can apply the
  // basis reduction in the CORPORATE_ACTION switch case.
  transactions = expandCorporateActions(transactions);

  // Pass 1: detect superficial-loss violations across the whole history.
  // Each violation tells us which transaction absorbs the disallowed loss
  // (either remaining shares at the sale, or a specific future BUY).
  const violations = detectSuperficialLosses(transactions);
  const lossAtSale = new Map<string, number>(); // saleTxId → absorbed-at-remaining amount
  const lossAtBuy = new Map<string, number>(); // buyTxId → absorbed-at-buy amount
  // Every SELL whose loss is disallowed (regardless of absorption path) so
  // the realized-gain math knows to skip it. Without this, look-forward
  // absorption double-counts the loss (once realized on the SELL, once
  // added to the BUY's ACB).
  const superficialSaleIds = new Set<string>();
  for (const v of violations) {
    superficialSaleIds.add(v.saleTransactionId);
    if (v.absorbedBy.kind === "remaining") {
      lossAtSale.set(v.saleTransactionId, (lossAtSale.get(v.saleTransactionId) ?? 0) + v.lossAmount);
    } else {
      lossAtBuy.set(
        v.absorbedBy.transactionId,
        (lossAtBuy.get(v.absorbedBy.transactionId) ?? 0) + v.lossAmount,
      );
    }
  }

  const byTicker = new Map<string, Tx[]>();
  for (const tx of transactions) {
    // Cash flows aren't holdings — they affect the cash balance, not ACB or
    // share counts. Skip so we don't materialize a phantom holding.
    if (!tx.ticker) continue;
    const arr = byTicker.get(tx.ticker) ?? [];
    arr.push(tx);
    byTicker.set(tx.ticker, arr);
  }

  const holdings: Holding[] = [];

  for (const [ticker, txns] of byTicker) {
    const sorted = [...txns].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

    // Non-registered pool (ACB-tracked)
    let nonRegQty = 0;
    let nonRegCostBasis = 0;
    let realizedGain = 0;
    let totalDividends = 0;
    let totalForeignTax = 0;
    let firstOpenAt: Date | null = null;
    // The position's "accounting currency" — captured from the first
    // share-affecting tx (BUY or TRANSFER_IN). Drives whether we need to
    // FX-convert the live market quote.
    let positionCurrency: string | null = null;

    // Per-kind ledger for the byKind breakdown
    const byKind = emptyByKind();

    for (const tx of sorted) {
      const isNonReg = isNonRegisteredKind(tx.brokerageKind);
      const slice = byKind[tx.brokerageKind];

      switch (tx.kind) {
        case "BUY": {
          if (!firstOpenAt) firstOpenAt = tx.occurredAt;
          if (!positionCurrency) positionCurrency = tx.currency;
          // If this BUY absorbs a disallowed superficial loss from an earlier
          // SELL, add that amount to its cost basis (CRA-mandated adjustment).
          const absorbedLoss = lossAtBuy.get(tx.id) ?? 0;
          const grossCost = tx.quantity * tx.price + tx.fees + absorbedLoss;
          slice.quantity += tx.quantity;
          slice.costBasis += grossCost;
          if (isNonReg) {
            nonRegQty += tx.quantity;
            nonRegCostBasis += grossCost;
          }
          break;
        }

        case "SELL": {
          const proceeds = tx.quantity * tx.price - tx.fees;
          const isSuperficial = superficialSaleIds.has(tx.id);
          const absorbedByRemaining = (lossAtSale.get(tx.id) ?? 0) > 0;
          if (isNonReg && nonRegQty > 1e-9) {
            const acb = nonRegCostBasis / nonRegQty;
            const qtySold = Math.min(tx.quantity, nonRegQty);
            const costRemoved = qtySold * acb;

            if (isSuperficial && absorbedByRemaining) {
              // Disallowed loss absorbed by remaining shares: cost basis
              // reduces by *proceeds* (not the higher costRemoved). The
              // difference stays in the pool, raising the ACB on the
              // unsold shares. Realized gain is NOT recorded.
              nonRegCostBasis -= proceeds;
              nonRegQty -= qtySold;
            } else if (isSuperficial) {
              // Disallowed loss absorbed by a later BUY: cost is removed
              // normally; the loss amount is added back to that future
              // BUY's cost basis via lossAtBuy. Realized gain is NOT
              // recorded — that would double-count the loss.
              nonRegCostBasis -= costRemoved;
              nonRegQty -= qtySold;
            } else {
              nonRegCostBasis -= costRemoved;
              nonRegQty -= qtySold;
              realizedGain += proceeds - costRemoved;
            }
            if (nonRegQty <= 1e-9) {
              nonRegQty = 0;
              nonRegCostBasis = 0;
            }
          }
          // Per-kind slice still tracks qty/cost for display
          if (slice.quantity > 1e-9) {
            const perShareCost = slice.costBasis / slice.quantity;
            const qtySold = Math.min(tx.quantity, slice.quantity);
            slice.quantity -= qtySold;
            slice.costBasis -= qtySold * perShareCost;
            if (slice.quantity <= 1e-9) {
              slice.quantity = 0;
              slice.costBasis = 0;
            }
          }
          break;
        }

        case "DIVIDEND": {
          // RETURN_OF_CAPITAL is special: CRA treats it as a basis reduction,
          // not as taxable income. Drop the distribution amount out of the
          // pool cost basis (per-share ACB falls; share count unchanged) and
          // do NOT add it to totalDividends. Any FWT still rolls up for
          // recoverability tracking.
          if (tx.dividendType === "RETURN_OF_CAPITAL") {
            if (isNonReg) {
              nonRegCostBasis = Math.max(0, nonRegCostBasis - tx.price);
            }
            if (slice.quantity > 1e-9) {
              slice.costBasis = Math.max(0, slice.costBasis - tx.price);
            }
            totalForeignTax += tx.foreignTaxWithheld;
            break;
          }
          // For DIVIDEND, `price` holds the total amount received (gross of FWT).
          totalDividends += tx.price;
          totalForeignTax += tx.foreignTaxWithheld;
          break;
        }

        case "SPLIT": {
          const ratio = tx.splitRatio ?? 1;
          if (ratio > 0) {
            // Non-reg pool: qty scales, total cost basis unchanged → ACB/share divides
            if (isNonReg) {
              nonRegQty *= ratio;
              // nonRegCostBasis stays the same (per-share ACB falls)
            }
            // Per-kind: same logic
            slice.quantity *= ratio;
            // slice.costBasis unchanged
          }
          break;
        }

        case "TRANSFER_IN": {
          if (!firstOpenAt) firstOpenAt = tx.occurredAt;
          if (!positionCurrency) positionCurrency = tx.currency;
          const grossCost = tx.quantity * tx.price;
          slice.quantity += tx.quantity;
          slice.costBasis += grossCost;
          if (isNonReg) {
            nonRegQty += tx.quantity;
            nonRegCostBasis += grossCost;
          }
          break;
        }

        case "CORPORATE_ACTION": {
          // Parent-side effect: SPINOFF removes a slice of cost basis without
          // changing qty; MERGER / NAME_CHANGE / REDENOMINATION zero out the
          // parent (qty + cost both transferred to the synthetic TRANSFER_IN
          // on the child ticker emitted by expandCorporateActions).
          const payload = tx.corporateActionPayload;
          if (!payload) break;
          if (payload.event === "SPINOFF") {
            const totalPct = payload.legs.reduce((s, l) => s + l.basisAllocationPct, 0);
            const fraction = Math.max(0, Math.min(1, totalPct / 100));
            const removeNonReg = nonRegCostBasis * fraction;
            const removeSlice = slice.costBasis * fraction;
            if (isNonReg) {
              nonRegCostBasis -= removeNonReg;
              if (nonRegCostBasis < 0) nonRegCostBasis = 0;
            }
            slice.costBasis -= removeSlice;
            if (slice.costBasis < 0) slice.costBasis = 0;
          } else {
            // MERGER / NAME_CHANGE / REDENOMINATION: parent goes to zero
            if (isNonReg) {
              nonRegCostBasis = 0;
              nonRegQty = 0;
            }
            slice.quantity = 0;
            slice.costBasis = 0;
          }
          break;
        }

        case "TRANSFER_OUT": {
          // Treat like SELL for accounting; CRA may deem this a disposition
          // depending on the destination (non-reg → registered = deemed sale at FMV).
          // We do the simple version: remove cost basis at current ACB,
          // do not register a realized gain (user can convert to SELL if needed).
          if (isNonReg && nonRegQty > 1e-9) {
            const acb = nonRegCostBasis / nonRegQty;
            const qtyOut = Math.min(tx.quantity, nonRegQty);
            nonRegQty -= qtyOut;
            nonRegCostBasis -= qtyOut * acb;
            if (nonRegQty <= 1e-9) {
              nonRegQty = 0;
              nonRegCostBasis = 0;
            }
          }
          if (slice.quantity > 1e-9) {
            const perShareCost = slice.costBasis / slice.quantity;
            const qtyOut = Math.min(tx.quantity, slice.quantity);
            slice.quantity -= qtyOut;
            slice.costBasis -= qtyOut * perShareCost;
            if (slice.quantity <= 1e-9) {
              slice.quantity = 0;
              slice.costBasis = 0;
            }
          }
          break;
        }
      }
    }

    // Sum the registered side from byKind for the summary fields
    let regQty = 0;
    let regCost = 0;
    for (const kind of REGISTERED_KINDS) {
      regQty += byKind[kind].quantity;
      regCost += byKind[kind].costBasis;
    }

    const totalQty = nonRegQty + regQty;
    if (totalQty <= 1e-9) continue;

    holdings.push({
      ticker,
      currency: positionCurrency ?? sorted[0].currency ?? "CAD",
      quantity: totalQty,
      costBasis: nonRegCostBasis + regCost,
      nonRegQuantity: nonRegQty,
      nonRegCostBasis: nonRegCostBasis,
      acb: nonRegQty > 0 ? nonRegCostBasis / nonRegQty : 0,
      realizedGain,
      totalForeignTaxWithheld: totalForeignTax,
      registeredQuantity: regQty,
      registeredCostBasis: regCost,
      openedAt: firstOpenAt ?? sorted[0].occurredAt,
      totalDividends,
      byKind,
    });
  }

  return holdings.sort((a, b) => b.costBasis - a.costBasis);
}

export function summarize(holdings: Holding[]): PortfolioSummary {
  let totalCost = 0;
  let totalRealized = 0;
  let totalDividends = 0;
  let totalForeignTaxWithheld = 0;
  for (const h of holdings) {
    totalCost += h.costBasis;
    totalRealized += h.realizedGain;
    totalDividends += h.totalDividends;
    totalForeignTaxWithheld += h.totalForeignTaxWithheld;
  }
  return { holdings, totalCost, totalRealized, totalDividends, totalForeignTaxWithheld };
}

/**
 * Cumulative invested capital over time (the "Total invested" sparkline on
 * the dashboard). Tracks net money put into positions, ACB-aware on non-reg
 * sells.
 */
export function investedCapitalSeries(
  transactions: Tx[],
): { ts: number; close: number }[] {
  const sorted = [...transactions].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  type PoolState = { qty: number; cost: number };
  const nonRegPool = new Map<string, PoolState>(); // by ticker
  const regPool = new Map<string, PoolState>(); // by (ticker:kind) key

  let invested = 0;
  const series: { ts: number; close: number }[] = [];

  for (const tx of sorted) {
    if (!tx.ticker) continue; // skip cash flows
    const isNonReg = isNonRegisteredKind(tx.brokerageKind);

    if (tx.kind === "BUY" || tx.kind === "TRANSFER_IN") {
      const cost = tx.quantity * tx.price + (tx.kind === "BUY" ? tx.fees : 0);
      invested += cost;
      const map = isNonReg ? nonRegPool : regPool;
      const key = isNonReg ? tx.ticker : `${tx.ticker}:${tx.brokerageKind}`;
      const p = map.get(key) ?? { qty: 0, cost: 0 };
      p.qty += tx.quantity;
      p.cost += cost;
      map.set(key, p);
    } else if (tx.kind === "SELL" || tx.kind === "TRANSFER_OUT") {
      const map = isNonReg ? nonRegPool : regPool;
      const key = isNonReg ? tx.ticker : `${tx.ticker}:${tx.brokerageKind}`;
      const p = map.get(key);
      if (p && p.qty > 1e-9) {
        const perShare = p.cost / p.qty;
        const qty = Math.min(tx.quantity, p.qty);
        const removed = qty * perShare;
        p.qty -= qty;
        p.cost -= removed;
        invested -= removed;
        if (p.qty <= 1e-9) {
          p.qty = 0;
          p.cost = 0;
        }
      }
    } else if (tx.kind === "SPLIT") {
      // No money in/out; pool qty changes but cost basis unchanged → invested unchanged
    }

    series.push({ ts: tx.occurredAt.getTime(), close: Math.max(invested, 0) });
  }

  return series;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const NON_REG_KINDS: BrokerageKind[] = ["NON_REGISTERED", "JOINT_NON_REGISTERED"];
const REGISTERED_KINDS: BrokerageKind[] = [
  "TFSA",
  "RRSP",
  "FHSA",
  "RESP",
  "LIRA",
  "RRIF",
];
const ALL_KINDS: BrokerageKind[] = [
  ...NON_REG_KINDS,
  ...REGISTERED_KINDS,
  "CORPORATE",
];

export function isNonRegisteredKind(kind: BrokerageKind): boolean {
  return kind === "NON_REGISTERED" || kind === "JOINT_NON_REGISTERED";
}

export function isRegisteredKind(kind: BrokerageKind): boolean {
  return REGISTERED_KINDS.includes(kind);
}

function emptyByKind(): Record<BrokerageKind, AccountSliceSummary> {
  const out = {} as Record<BrokerageKind, AccountSliceSummary>;
  for (const k of ALL_KINDS) out[k] = { quantity: 0, costBasis: 0 };
  return out;
}

export { NON_REG_KINDS, REGISTERED_KINDS };
