import type { Tx } from "./types";

/**
 * Expand CORPORATE_ACTION rows into synthetic per-leg TRANSFER_IN rows.
 *
 * The action row stays in the stream so deriveHoldings can apply the
 * parent-side basis adjustment in its CORPORATE_ACTION switch case.
 * The synthetic rows give the child tickers an opening position with the
 * computed shares + per-share basis derived from the parent's state at
 * action date.
 *
 * For SPINOFF (most common):
 *   parent T owns 100 sh @ ACB $50 (basis $5,000)
 *   spin payload: legs=[{ticker:WBD, ratio:0.241917, basisAllocationPct:16.5}]
 *   new WBD shares = 100 × 0.241917 = 24.1917
 *   WBD basis    = 5,000 × 0.165 = $825
 *   WBD per-share = 825 / 24.1917 ≈ $34.10
 *   Parent T keeps 100 sh, basis drops to 5,000 × 0.835 = $4,175 (handled
 *   by the parent's CORPORATE_ACTION case in deriveHoldings).
 *
 * For MERGER / NAME_CHANGE / REDENOMINATION:
 *   Single leg gets all parent qty × ratio + all of parent's basis.
 */
export function expandCorporateActions(transactions: Tx[]): Tx[] {
  const hasAction = transactions.some((t) => t.kind === "CORPORATE_ACTION");
  if (!hasAction) return transactions;

  // Per-ticker running state in chronological order, so we know parent
  // qty + cost at the action date when expanding legs.
  const sorted = [...transactions].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  type State = { qty: number; cost: number };
  const stateByTicker = new Map<string, State>();
  const synthetic: Tx[] = [];

  for (const tx of sorted) {
    if (tx.kind === "CORPORATE_ACTION") {
      if (!tx.ticker || !tx.corporateActionPayload) continue;
      const parent = tx.ticker;
      const state = stateByTicker.get(parent) ?? { qty: 0, cost: 0 };
      if (state.qty <= 0) continue; // no parent position to act on — skip silently

      const payload = tx.corporateActionPayload;

      if (payload.event === "SPINOFF") {
        for (const leg of payload.legs) {
          const newQty = state.qty * leg.ratio;
          const allocatedBasis = state.cost * (leg.basisAllocationPct / 100);
          if (newQty <= 0 || allocatedBasis <= 0) continue;
          synthetic.push({
            id: `${tx.id}-spin-${leg.ticker}`,
            brokerageId: tx.brokerageId,
            brokerageKind: tx.brokerageKind,
            ticker: leg.ticker.toUpperCase(),
            kind: "TRANSFER_IN",
            currency: tx.currency,
            fxRateToCad: tx.fxRateToCad,
            quantity: newQty,
            price: allocatedBasis / newQty,
            fees: 0,
            foreignTaxWithheld: 0,
            dividendType: null,
            reasonCode: null,
            isDrip: false,
            corporateActionPayload: null,
            maturesAt: null,
            occurredAt: tx.occurredAt,
            note: `[spinoff from ${parent}] ${leg.basisAllocationPct.toFixed(2)}% basis, ratio ${leg.ratio}`,
            splitRatio: null,
          });
        }
        // Update parent state: qty unchanged, basis reduced.
        const totalPct = payload.legs.reduce((s, l) => s + l.basisAllocationPct, 0);
        state.cost *= 1 - Math.max(0, Math.min(1, totalPct / 100));
        stateByTicker.set(parent, state);
        continue;
      }

      // MERGER / NAME_CHANGE / REDENOMINATION — transfer all qty + basis to leg[0]
      const leg = payload.legs[0];
      if (!leg) continue;
      const newQty = state.qty * leg.ratio;
      if (newQty <= 0) continue;
      synthetic.push({
        id: `${tx.id}-${payload.event.toLowerCase()}-${leg.ticker}`,
        brokerageId: tx.brokerageId,
        brokerageKind: tx.brokerageKind,
        ticker: leg.ticker.toUpperCase(),
        kind: "TRANSFER_IN",
        currency: tx.currency,
        fxRateToCad: tx.fxRateToCad,
        quantity: newQty,
        price: state.cost / newQty,
        fees: 0,
        foreignTaxWithheld: 0,
        dividendType: null,
        reasonCode: null,
        isDrip: false,
        corporateActionPayload: null,
        maturesAt: null,
        occurredAt: tx.occurredAt,
        note: `[${payload.event} from ${parent}] ratio ${leg.ratio}`,
        splitRatio: null,
      });
      // Parent is zeroed
      state.qty = 0;
      state.cost = 0;
      stateByTicker.set(parent, state);
      continue;
    }

    // Non-CA: update running state per ticker so later CA rows have it.
    if (!tx.ticker) continue;
    const state = stateByTicker.get(tx.ticker) ?? { qty: 0, cost: 0 };
    switch (tx.kind) {
      case "BUY":
      case "TRANSFER_IN":
        state.qty += tx.quantity;
        state.cost += tx.quantity * tx.price + (tx.kind === "BUY" ? tx.fees : 0);
        break;
      case "SELL":
      case "TRANSFER_OUT":
        if (state.qty > 0) {
          const acb = state.cost / state.qty;
          const qtyOut = Math.min(tx.quantity, state.qty);
          state.cost -= qtyOut * acb;
          state.qty -= qtyOut;
        }
        break;
      case "SPLIT":
        if (tx.splitRatio && tx.splitRatio > 0) state.qty *= tx.splitRatio;
        break;
    }
    stateByTicker.set(tx.ticker, state);
  }

  return synthetic.length > 0 ? [...transactions, ...synthetic] : transactions;
}
