"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { generateAnnualReview } from "@/lib/ai/annual-review";

type Result =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function generateAnnualReviewAction(args: { year: number }): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    const id = await generateAnnualReview({ userId: session.user.id, year: args.year });
    if (!id) return { ok: false, error: "No holdings to review yet." };
    revalidatePath("/annual-review");
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Review failed." };
  }
}
