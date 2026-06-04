"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { generateWeeklyReview } from "@/lib/ai/reviews";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

export async function generateWeeklyReviewAction(): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    const id = await generateWeeklyReview(session.user.id);
    if (!id) return { ok: false, error: "No holdings to review yet." };
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Review failed.";
    return { ok: false, error: message };
  }
}
