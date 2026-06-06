"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  BOOLEAN_PREFERENCE_KEYS,
  setUserPreference,
  setTaxProfile,
  setPerformanceProfile,
  type TaxProfile,
  type PerformanceProfile,
  type UserPreferences,
} from "@/lib/preferences";

type ActionResult = { ok: true } | { ok: false; error: string };

type BooleanPreferenceKey = (typeof BOOLEAN_PREFERENCE_KEYS)[number];

export async function setPreferenceAction(
  key: BooleanPreferenceKey,
  value: boolean,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  if (!BOOLEAN_PREFERENCE_KEYS.includes(key)) {
    return { ok: false, error: "Unknown preference." };
  }

  await setUserPreference(session.user.id, key as keyof UserPreferences, value);
  revalidatePath("/settings");
  return { ok: true };
}

export async function setTaxProfileAction(
  profile: TaxProfile,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  await setTaxProfile(session.user.id, profile);
  revalidatePath("/settings");
  revalidatePath("/review");
  return { ok: true };
}

export async function setPerformanceProfileAction(
  profile: PerformanceProfile,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  await setPerformanceProfile(session.user.id, profile);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/portfolio");
  return { ok: true };
}
