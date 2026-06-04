"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createDecisionEvent, markAlertEventRead, recordOutcome } from "@/lib/alerts/hub";
import type { DecisionOutcome, DecisionUrgency, RecommendedAction } from "@/generated/prisma";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Closes an OPEN decision with the user's manual outcome. Trades are entered
 * manually elsewhere — this just records what the user decided to do with the
 * recommendation, separate from any Transaction record.
 */
export async function recordDecisionOutcomeAction(input: {
  eventId: string;
  outcome: Exclude<DecisionOutcome, "OPEN">;
  executedQuantity?: number | null;
  executedPrice?: number | null;
  notes?: string | null;
}): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // Sanity on numerics — quantity must be positive when present, price too.
  if (input.executedQuantity != null) {
    if (!Number.isFinite(input.executedQuantity) || input.executedQuantity <= 0) {
      return { ok: false, error: "Executed quantity must be positive." };
    }
  }
  if (input.executedPrice != null) {
    if (!Number.isFinite(input.executedPrice) || input.executedPrice <= 0) {
      return { ok: false, error: "Executed price must be positive." };
    }
  }

  // Executed* fields only make sense when outcome includes EXECUTED.
  const isExecuted =
    input.outcome === "EXECUTED_AS_RECOMMENDED" ||
    input.outcome === "EXECUTED_REVISED";
  const executedQuantity = isExecuted ? input.executedQuantity ?? null : null;
  const executedPrice = isExecuted ? input.executedPrice ?? null : null;

  try {
    await recordOutcome({
      eventId: input.eventId,
      userId: session.user.id,
      outcome: input.outcome,
      executedQuantity,
      executedPrice,
      notes: input.notes?.trim() || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record outcome.";
    return { ok: false, error: message };
  }

  revalidatePath("/alerts");
  revalidatePath(`/alerts/${input.eventId}`);
  return { ok: true };
}

/**
 * Mark a notification-only AlertEvent as read. No-op for decision-grade
 * events — use recordDecisionOutcomeAction for those.
 */
export async function markAlertEventReadAction(input: {
  eventId: string;
}): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  try {
    await markAlertEventRead({ userId: session.user.id, eventId: input.eventId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to mark read.";
    return { ok: false, error: message };
  }

  revalidatePath("/alerts");
  revalidatePath(`/alerts/${input.eventId}`);
  return { ok: true };
}

/**
 * Raise a decision manually from a position / thesis / portfolio page. The
 * user is the author — they write the rationale themselves. Source = MANUAL.
 */
export async function raiseManualDecisionAction(input: {
  ticker: string | null;
  recommendedAction: RecommendedAction;
  urgency: DecisionUrgency;
  message: string;
  rationale: string;
  invalidationTrigger?: string | null;
  reviewEvent?: string | null;
  reviewByDate?: string | null;
}): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const message = input.message.trim();
  const rationale = input.rationale.trim();
  if (!message) return { ok: false, error: "Summary is required." };
  if (rationale.length < 10) {
    return { ok: false, error: "Rationale must be at least 10 characters — describe why you're raising this." };
  }

  const reviewByDate = input.reviewByDate ? new Date(input.reviewByDate) : null;
  if (reviewByDate && isNaN(reviewByDate.getTime())) {
    return { ok: false, error: "Review-by date is invalid." };
  }

  try {
    const event = await createDecisionEvent({
      userId: session.user.id,
      source: "MANUAL",
      ticker: input.ticker,
      message,
      rationale,
      recommendedAction: input.recommendedAction,
      urgency: input.urgency,
      invalidationTrigger: input.invalidationTrigger?.trim() || null,
      reviewEvent: input.reviewEvent?.trim() || null,
      reviewByDate,
    });
    revalidatePath("/alerts");
    if (input.ticker) revalidatePath(`/positions/${input.ticker.toUpperCase()}`);
    return { ok: true, eventId: event.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to raise decision.";
    return { ok: false, error: msg };
  }
}
