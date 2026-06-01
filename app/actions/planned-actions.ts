"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

type Result<T = void> = T extends void
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

/**
 * Mark the user's intent to act on a coaching alert. Creates a
 * PlannedAction the platform will use to:
 *   - Suppress repeat firings of the same alert while plan is open
 *   - Pre-fill the transaction form with the right reasonCode
 *   - Warn at entry time if the user is about to violate the plan
 *     (e.g. re-buying a TLH-harvested ticker within 30 days)
 */
export async function markIntentAction(args: {
  alertEventId: string;
  /** TLH window for TLH_HARVEST; null for plans without auto-expiry. */
  expiresAt?: string;
}): Promise<Result<{ plannedActionId: string }>> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userId = session.user.id;

  const event = await prisma.alertEvent.findUnique({
    where: { id: args.alertEventId },
    include: { alert: { select: { rule: true, userId: true } } },
  });
  if (!event || event.userId !== userId) {
    return { ok: false, error: "Alert event not found." };
  }

  const data = event.data as Record<string, unknown>;
  let kind: "TLH_HARVEST" | "REBALANCE" | "THESIS_REEVALUATION";
  let expiresAt: Date | null = null;
  let payload: Prisma.InputJsonValue;

  switch (event.alert.rule) {
    case "TLH_OPPORTUNITY": {
      kind = "TLH_HARVEST";
      // 30-day no-buyback window starts from today (when the user states
      // intent to harvest). The actual SELL is recorded later; the window
      // is measured from the planned date for the warning.
      expiresAt = args.expiresAt
        ? new Date(args.expiresAt)
        : new Date(Date.now() + 31 * 86_400_000);
      payload = {
        ticker: data.ticker ?? null,
        unrealizedLoss: data.unrealizedLoss ?? null,
        replacementTicker: data.replacementTicker ?? null,
        estimatedTaxSaving: data.estimatedTaxSaving ?? null,
      } as Prisma.InputJsonValue;
      break;
    }
    case "REBALANCE_DUE": {
      kind = "REBALANCE";
      payload = {
        category: data.category ?? null,
        direction: data.direction ?? null,
        driftDollars: data.driftDollars ?? null,
        mirrorCategory: data.mirrorCategory ?? null,
      } as Prisma.InputJsonValue;
      break;
    }
    case "THESIS_INVALIDATION_CANDIDATE": {
      kind = "THESIS_REEVALUATION";
      payload = {
        ticker: data.ticker ?? event.ticker ?? null,
        criterion: data.criterion ?? null,
      } as Prisma.InputJsonValue;
      break;
    }
    default:
      return { ok: false, error: "This alert isn't a coaching alert — no plan to track." };
  }

  const plan = await prisma.plannedAction.create({
    data: {
      userId,
      kind,
      ticker: event.ticker,
      payload,
      expiresAt,
      sourceAlertEventId: event.id,
    },
    select: { id: true },
  });

  await prisma.alertEvent.update({
    where: { id: event.id },
    data: { read: true },
  });

  revalidatePath("/");
  revalidatePath("/alerts");
  if (event.ticker) revalidatePath(`/positions/${event.ticker}`);

  return { ok: true, data: { plannedActionId: plan.id } };
}

export async function dismissAlertAction(alertEventId: string): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const event = await prisma.alertEvent.findUnique({
    where: { id: alertEventId },
    select: { id: true, userId: true, ticker: true },
  });
  if (!event || event.userId !== session.user.id) {
    return { ok: false, error: "Alert event not found." };
  }

  await prisma.alertEvent.update({
    where: { id: alertEventId },
    data: { read: true },
  });

  revalidatePath("/");
  revalidatePath("/alerts");
  if (event.ticker) revalidatePath(`/positions/${event.ticker}`);

  return { ok: true };
}

export async function dismissPlannedActionAction(
  plannedActionId: string,
): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const plan = await prisma.plannedAction.findUnique({
    where: { id: plannedActionId },
    select: { id: true, userId: true, ticker: true },
  });
  if (!plan || plan.userId !== session.user.id) {
    return { ok: false, error: "Plan not found." };
  }

  await prisma.plannedAction.update({
    where: { id: plannedActionId },
    data: { dismissedAt: new Date() },
  });

  revalidatePath("/");
  revalidatePath("/alerts");
  if (plan.ticker) revalidatePath(`/positions/${plan.ticker}`);

  return { ok: true };
}

/**
 * Called when a SELL transaction is recorded. If the user marked an open
 * TLH plan for this ticker, fulfill it. Same idea for REBALANCE plans —
 * any recorded BUY / SELL with matching reasonCode marks the plan done.
 * Best-effort; failures don't block the transaction write.
 */
export async function fulfillPlanIfMatchedAction(args: {
  userId: string;
  ticker: string | null;
  reasonCode: string | null;
}): Promise<void> {
  if (!args.ticker || !args.reasonCode) return;
  try {
    const plansToFulfill: Array<{ id: string }> = [];

    if (args.reasonCode === "TLH_HARVEST") {
      const tlh = await prisma.plannedAction.findMany({
        where: {
          userId: args.userId,
          kind: "TLH_HARVEST",
          ticker: args.ticker,
          fulfilledAt: null,
          dismissedAt: null,
        },
        select: { id: true },
      });
      plansToFulfill.push(...tlh);
    }
    if (args.reasonCode === "REBALANCE_DRIFT") {
      const reb = await prisma.plannedAction.findMany({
        where: {
          userId: args.userId,
          kind: "REBALANCE",
          fulfilledAt: null,
          dismissedAt: null,
        },
        select: { id: true },
      });
      plansToFulfill.push(...reb);
    }

    if (plansToFulfill.length === 0) return;
    await prisma.plannedAction.updateMany({
      where: { id: { in: plansToFulfill.map((p) => p.id) } },
      data: { fulfilledAt: new Date() },
    });
  } catch (err) {
    console.error("[planned-actions] fulfillment check failed:", err);
  }
}
