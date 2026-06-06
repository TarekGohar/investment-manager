"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  upsertInvestmentPolicy,
  type InvestmentPolicyData,
} from "@/lib/policy/ips";
import {
  upsertThesis,
  deleteThesis,
  reviewThesis,
  recordConvictionRating,
  type ThesisInput,
  type ConvictionHistoryRecord,
} from "@/lib/policy/thesis";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveInvestmentPolicyAction(
  data: InvestmentPolicyData,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // Validate allocations
  for (const [k, v] of Object.entries(data.targetAllocation)) {
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, error: `Allocation for "${k}" must be 0–100.` };
    }
  }
  for (const [k, v] of Object.entries(data.targetGeography)) {
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, error: `Geography for "${k}" must be 0–100.` };
    }
  }
  if (data.maxSingleNameWeightPct != null) {
    const v = data.maxSingleNameWeightPct;
    if (!Number.isFinite(v) || v < 1 || v > 50) {
      return { ok: false, error: "Per-name cap must be between 1 and 50." };
    }
  }
  if (data.maxThemeWeightPct != null) {
    const v = data.maxThemeWeightPct;
    if (!Number.isFinite(v) || v < 1 || v > 50) {
      return { ok: false, error: "Per-theme cap must be between 1 and 50." };
    }
  }

  await upsertInvestmentPolicy(session.user.id, data);
  revalidatePath("/review");
  return { ok: true };
}

export async function saveThesisAction(input: ThesisInput): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  if (!input.ticker || !input.body || input.body.trim().length < 10) {
    return { ok: false, error: "Thesis body must be at least 10 characters." };
  }
  await upsertThesis(session.user.id, input);
  revalidatePath(`/positions/${input.ticker.toUpperCase()}`);
  revalidatePath("/review");
  return { ok: true };
}

export async function deleteThesisAction(ticker: string): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  await deleteThesis(session.user.id, ticker);
  revalidatePath(`/positions/${ticker.toUpperCase()}`);
  revalidatePath("/review");
  return { ok: true };
}

export async function reviewThesisAction(
  ticker: string,
): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const body = await reviewThesis(session.user.id, ticker);
  if (!body) return { ok: false, error: "AI review failed." };
  revalidatePath(`/positions/${ticker.toUpperCase()}`);
  revalidatePath("/review");
  return { ok: true, body };
}

export async function recordConvictionRatingAction(input: {
  ticker: string;
  rating: number;
  notes?: string | null;
}): Promise<
  | { ok: true; trajectory: ConvictionHistoryRecord[] }
  | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const result = await recordConvictionRating({
    userId: session.user.id,
    ticker: input.ticker,
    rating: input.rating,
    notes: input.notes ?? null,
    source: "MANUAL",
  });
  if (result.ok) {
    revalidatePath(`/positions/${input.ticker.toUpperCase()}`);
    revalidatePath("/review");
  }
  return result;
}
