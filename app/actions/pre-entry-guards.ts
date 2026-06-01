"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInvestmentPolicy } from "@/lib/policy/ips";
import { getHolding } from "@/lib/portfolio/queries";
import { getQuote } from "@/lib/marketdata";

/**
 * Composite pre-entry guard check. Called by the transaction form before
 * submit to surface warnings the user can override but should at least see.
 * All checks are advisory — never blockers.
 */
export type PreEntryWarning =
  | {
      kind: "TLH_WINDOW";
      severity: "danger";
      title: string;
      detail: string;
    }
  | {
      kind: "PANIC_SELL";
      severity: "warning";
      title: string;
      detail: string;
      drawdownPct: number;
      windowDays: number;
    }
  | {
      kind: "ACTIVE_THESIS_SELL";
      severity: "warning";
      title: string;
      detail: string;
      thesisStatus: string;
    };

export type PreEntryGuardArgs = {
  kind: string;
  ticker: string | null;
  occurredAtIso: string;
  /** For SELL panic-check: optionally pass the qty being sold for context. */
  quantity?: number;
};

export type PreEntryGuardResult =
  | { ok: true; warnings: PreEntryWarning[] }
  | { ok: false; error: string };

export async function checkPreEntryGuardsAction(
  args: PreEntryGuardArgs,
): Promise<PreEntryGuardResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userId = session.user.id;

  const warnings: PreEntryWarning[] = [];

  if (!args.ticker) {
    return { ok: true, warnings };
  }

  // TLH-window guard fires on BUY: if there's an open TLH_HARVEST plan for
  // this ticker, buying it back within 30 days violates CRA's superficial
  // loss rule. The loss the user planned to harvest will be disallowed.
  if (args.kind === "BUY") {
    const openTlh = await prisma.plannedAction.findFirst({
      where: {
        userId,
        kind: "TLH_HARVEST",
        ticker: args.ticker,
        fulfilledAt: null,
        dismissedAt: null,
      },
      select: { plannedAt: true, expiresAt: true, payload: true },
    });
    if (openTlh) {
      const expiresAt = openTlh.expiresAt ?? new Date(openTlh.plannedAt.getTime() + 31 * 86_400_000);
      const daysLeft = Math.max(
        0,
        Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000),
      );
      const payload = openTlh.payload as Record<string, unknown> | null;
      const replacement =
        payload && typeof payload.replacementTicker === "string"
          ? String(payload.replacementTicker)
          : null;
      warnings.push({
        kind: "TLH_WINDOW",
        severity: "danger",
        title: "Open TLH plan for this ticker",
        detail:
          `You planned to harvest a loss on ${args.ticker}. Buying it back today ` +
          `triggers a superficial loss — the disallowed loss flows into this BUY's ACB. ` +
          `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in the window` +
          (replacement
            ? `; the suggested replacement was ${replacement}.`
            : ` — record the SELL first or pick a non-identical replacement.`),
      });
    }
  }

  // SELL-time guards: panic-sell heuristic and active-thesis warning.
  if (args.kind === "SELL") {
    const [holding, policy, quote] = await Promise.all([
      getHolding(userId, args.ticker),
      getInvestmentPolicy(userId),
      getQuote(args.ticker),
    ]);

    // Panic-sell: position is down >X% in <Y days vs ACB, per IPS thresholds.
    // Best-effort with current data — for a precise window-based check we'd
    // need historical quotes, which we don't always have.
    if (
      holding &&
      policy.panicSellDrawdownPct != null &&
      policy.panicSellDrawdownPct > 0 &&
      quote &&
      holding.acb > 0
    ) {
      const drawdownPct = ((quote.price - holding.acb) / holding.acb) * 100;
      if (drawdownPct <= -policy.panicSellDrawdownPct) {
        const window = policy.panicSellWindowDays ?? 30;
        warnings.push({
          kind: "PANIC_SELL",
          severity: "warning",
          title: "This looks like a panic sell",
          detail:
            `${args.ticker} is ${drawdownPct.toFixed(1)}% below your ACB ` +
            `(${holding.acb.toFixed(2)} → ${quote.price.toFixed(2)}). Your IPS flags ` +
            `sells past ${policy.panicSellDrawdownPct}% drawdown within ${window} days ` +
            `as panic territory. Use a non-discretionary reason code if this is ` +
            `thesis-driven or tax-driven; pick DISCRETIONARY if you want it flagged.`,
          drawdownPct,
          windowDays: window,
        });
      }
    }

    // Active-thesis warning: if a Thesis exists with status=ACTIVE, the user
    // probably wants to mark it TRIMMED / EXITED / INVALIDATED before selling.
    const thesis = await prisma.thesis.findUnique({
      where: { userId_ticker: { userId, ticker: args.ticker } },
      select: { status: true },
    });
    if (thesis && thesis.status === "ACTIVE") {
      warnings.push({
        kind: "ACTIVE_THESIS_SELL",
        severity: "warning",
        title: "Thesis still marked ACTIVE",
        detail:
          `Your thesis for ${args.ticker} is currently ACTIVE. Selling without ` +
          `updating the thesis leaves the ledger inconsistent. Update the thesis ` +
          `status (TRIMMED / EXITED / INVALIDATED) on the position page after ` +
          `you record this sell.`,
        thesisStatus: thesis.status,
      });
    }
  }

  return { ok: true, warnings };
}
