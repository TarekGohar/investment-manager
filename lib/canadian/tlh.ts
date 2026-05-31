import "server-only";
import type { EnrichedHolding } from "@/lib/portfolio/types";
import type { Tx } from "@/lib/portfolio/types";
import { tlhTaxSaving } from "./tax-rates";
import { getReplacements, type ReplacementSuggestion } from "./replacement-pairs";
import { getActiveSuperficialLossWindows } from "./superficial-loss";

export type TlhCandidate = {
  ticker: string;
  /** Negative number — total unrealized loss in non-reg pool */
  unrealizedLoss: number;
  /** Non-registered shares we'd be selling */
  nonRegQuantity: number;
  acb: number;
  currentPrice: number;
  /**
   * Dollar saving at the user's supplied marginal cap-gains rate. Null when
   * the user has not set their rate — UI must surface a CTA to set it rather
   * than show a guessed estimate.
   */
  estimatedTaxSaving: number | null;
  /** Sister ETFs / replacements that should avoid the superficial loss rule */
  replacements: ReplacementSuggestion[];
  /**
   * If the user has an active 30-day superficial-loss window on this ticker,
   * harvesting now and rebuying the same ticker would still be a violation.
   * Replacements are the answer.
   */
  hasActiveWindow: boolean;
  /** Friendly string: when can you buy back the same ticker safely */
  earliestBuybackDate: Date;
};

type Args = {
  holdings: EnrichedHolding[];
  transactions: Tx[];
  /** Don't surface losses smaller than this; reduces noise */
  minLoss?: number;
  /**
   * User-supplied combined marginal cap-gains rate (decimal, e.g. 0.2665).
   * Pass `null` when the user has not set it — saving estimates become null
   * and the UI shows a CTA.
   */
  capGainsRate?: number | null;
};

export function findTlhCandidates({
  holdings,
  transactions,
  minLoss = 100,
  capGainsRate = null,
}: Args): TlhCandidate[] {
  const activeWindows = getActiveSuperficialLossWindows(transactions);
  const activeByTicker = new Map(activeWindows.map((w) => [w.ticker, w]));

  const candidates: TlhCandidate[] = [];
  for (const h of holdings) {
    if (h.nonRegQuantity <= 0) continue;
    if (h.marketPrice == null) continue;
    const lossPerShare = h.marketPrice - h.acb;
    const totalLoss = lossPerShare * h.nonRegQuantity;
    if (totalLoss >= -minLoss) continue; // not enough loss to bother

    const tlh = tlhTaxSaving(totalLoss, capGainsRate);
    const activeWindow = activeByTicker.get(h.ticker);

    // Earliest safe buyback of the SAME ticker is 31 days after today
    const earliestBuybackDate = new Date(Date.now() + 31 * 86_400_000);

    candidates.push({
      ticker: h.ticker,
      unrealizedLoss: totalLoss,
      nonRegQuantity: h.nonRegQuantity,
      acb: h.acb,
      currentPrice: h.marketPrice,
      estimatedTaxSaving: tlh ? tlh.saving : null,
      replacements: getReplacements(h.ticker),
      hasActiveWindow: !!activeWindow,
      earliestBuybackDate,
    });
  }

  return candidates.sort((a, b) => a.unrealizedLoss - b.unrealizedLoss);
}
