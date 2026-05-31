import type { Holding, PortfolioSummary, Tx } from "./types";

type Lot = {
  qty: number;
  costPerShare: number;
  openedAt: Date;
};

/**
 * Derive current holdings from a list of transactions using FIFO lot accounting.
 *
 * - BUY pushes a lot; fees are amortized into the lot's cost per share.
 * - SELL pops from the oldest lot first; realized gain = proceeds minus cost removed.
 * - DIVIDEND adds to totalDividends; does not affect lots.
 * - SPLIT scales all open lots' qty by the ratio and inverse-scales their price.
 * - TRANSFER_IN / TRANSFER_OUT behave like BUY / SELL but don't realize a gain.
 *
 * Tickers with zero open lots are omitted from the result.
 */
export function deriveHoldings(transactions: Tx[]): Holding[] {
  const byTicker = new Map<string, Tx[]>();
  for (const tx of transactions) {
    const arr = byTicker.get(tx.ticker) ?? [];
    arr.push(tx);
    byTicker.set(tx.ticker, arr);
  }

  const holdings: Holding[] = [];

  for (const [ticker, txns] of byTicker) {
    const sorted = [...txns].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    let lots: Lot[] = [];
    let realizedGain = 0;
    let totalDividends = 0;
    let firstOpenAt: Date | null = null;

    for (const tx of sorted) {
      switch (tx.kind) {
        case "BUY": {
          const costPerShare = tx.quantity > 0 ? tx.price + tx.fees / tx.quantity : tx.price;
          lots.push({ qty: tx.quantity, costPerShare, openedAt: tx.occurredAt });
          if (!firstOpenAt) firstOpenAt = tx.occurredAt;
          break;
        }

        case "SELL": {
          let remaining = tx.quantity;
          const proceeds = tx.quantity * tx.price - tx.fees;
          let costRemoved = 0;
          while (remaining > 1e-9 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(remaining, lot.qty);
            costRemoved += take * lot.costPerShare;
            lot.qty -= take;
            remaining -= take;
            if (lot.qty <= 1e-9) lots.shift();
          }
          realizedGain += proceeds - costRemoved;
          break;
        }

        case "DIVIDEND":
          // Dividend amount is stored in `price`; quantity is unused (we set it to 1)
          totalDividends += tx.price;
          break;

        case "SPLIT": {
          const ratio = tx.splitRatio ?? 1;
          if (ratio > 0) {
            lots = lots.map((l) => ({
              ...l,
              qty: l.qty * ratio,
              costPerShare: l.costPerShare / ratio,
            }));
          }
          break;
        }

        case "TRANSFER_IN":
          lots.push({
            qty: tx.quantity,
            costPerShare: tx.price,
            openedAt: tx.occurredAt,
          });
          if (!firstOpenAt) firstOpenAt = tx.occurredAt;
          break;

        case "TRANSFER_OUT": {
          let remaining = tx.quantity;
          while (remaining > 1e-9 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(remaining, lot.qty);
            lot.qty -= take;
            remaining -= take;
            if (lot.qty <= 1e-9) lots.shift();
          }
          break;
        }
      }
    }

    const totalQty = lots.reduce((sum, l) => sum + l.qty, 0);
    if (totalQty <= 1e-9) continue;

    const totalCost = lots.reduce((sum, l) => sum + l.qty * l.costPerShare, 0);

    holdings.push({
      ticker,
      quantity: totalQty,
      avgCost: totalCost / totalQty,
      costBasis: totalCost,
      openedAt: firstOpenAt ?? sorted[0].occurredAt,
      realizedGain,
      totalDividends,
    });
  }

  return holdings.sort((a, b) => b.costBasis - a.costBasis);
}

export function summarize(holdings: Holding[]): PortfolioSummary {
  let totalCost = 0;
  let totalRealized = 0;
  let totalDividends = 0;
  for (const h of holdings) {
    totalCost += h.costBasis;
    totalRealized += h.realizedGain;
    totalDividends += h.totalDividends;
  }
  return { holdings, totalCost, totalRealized, totalDividends };
}

/**
 * For each transaction date, the running sum of invested capital (BUYs minus SELLs at cost basis).
 * Used to render the "Total invested" sparkline pre-market-data.
 */
export function investedCapitalSeries(transactions: Tx[]): { ts: number; close: number }[] {
  const sorted = [...transactions].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  // Track per-ticker FIFO lots so SELLs remove cost at their actual basis
  const lots = new Map<string, Lot[]>();
  let invested = 0;
  const series: { ts: number; close: number }[] = [];

  for (const tx of sorted) {
    if (tx.kind === "BUY" || tx.kind === "TRANSFER_IN") {
      const costPerShare = tx.quantity > 0 ? tx.price + tx.fees / tx.quantity : tx.price;
      invested += tx.quantity * costPerShare;
      const arr = lots.get(tx.ticker) ?? [];
      arr.push({ qty: tx.quantity, costPerShare, openedAt: tx.occurredAt });
      lots.set(tx.ticker, arr);
    } else if (tx.kind === "SELL" || tx.kind === "TRANSFER_OUT") {
      let remaining = tx.quantity;
      const arr = lots.get(tx.ticker) ?? [];
      while (remaining > 1e-9 && arr.length > 0) {
        const lot = arr[0];
        const take = Math.min(remaining, lot.qty);
        invested -= take * lot.costPerShare;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) arr.shift();
      }
      lots.set(tx.ticker, arr);
    } else if (tx.kind === "SPLIT") {
      const ratio = tx.splitRatio ?? 1;
      if (ratio > 0) {
        const arr = lots.get(tx.ticker) ?? [];
        const next = arr.map((l) => ({ ...l, qty: l.qty * ratio, costPerShare: l.costPerShare / ratio }));
        lots.set(tx.ticker, next);
      }
    }
    series.push({ ts: tx.occurredAt.getTime(), close: Math.max(invested, 0) });
  }

  return series;
}
