"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  PREFERENCE_KEYS,
  setUserPreference,
  type UserPreferences,
} from "@/lib/preferences";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function setPreferenceAction(
  key: keyof UserPreferences,
  value: boolean,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  if (!PREFERENCE_KEYS.includes(key)) {
    return { ok: false, error: "Unknown preference." };
  }

  await setUserPreference(session.user.id, key, value);
  revalidatePath("/settings");
  return { ok: true };
}
