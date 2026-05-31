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
  type ThesisInput,
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

  await upsertInvestmentPolicy(session.user.id, data);
  revalidatePath("/policy");
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
  revalidatePath("/policy");
  return { ok: true };
}

export async function deleteThesisAction(ticker: string): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  await deleteThesis(session.user.id, ticker);
  revalidatePath(`/positions/${ticker.toUpperCase()}`);
  revalidatePath("/policy");
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
  revalidatePath("/policy");
  return { ok: true, body };
}
