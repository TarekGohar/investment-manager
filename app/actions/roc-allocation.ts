"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  upsertRoCAllocation,
  deleteRoCAllocation,
  reclassifyDividendsForYear,
  type RoCAllocationData,
} from "@/lib/canadian/reit-decomposition";

type Result<T = void> = T extends void
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

export async function saveRoCAllocationAction(
  input: Omit<RoCAllocationData, "id" | "appliedAt" | "createdAt" | "updatedAt">,
): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    await upsertRoCAllocation(session.user.id, input);
    revalidatePath("/tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed." };
  }
}

export async function deleteRoCAllocationAction(id: string): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    await deleteRoCAllocation(session.user.id, id);
    revalidatePath("/tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed." };
  }
}

export async function applyRoCAllocationAction(args: {
  ticker: string;
  year: number;
}): Promise<Result<{ originalCount: number; createdCount: number; totalProcessed: number }>> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    const result = await reclassifyDividendsForYear(session.user.id, args.ticker, args.year);
    revalidatePath("/tax");
    revalidatePath("/portfolio");
    revalidatePath("/transactions");
    revalidatePath(`/positions/${args.ticker.toUpperCase()}`);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reclassify failed." };
  }
}
