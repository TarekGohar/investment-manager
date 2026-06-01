"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getFxRateToCad } from "@/lib/marketdata/fx";

export type FxLookupActionResult =
  | {
      ok: true;
      currency: string;
      rate: number;
      asOf: string; // ISO date — "YYYY-MM-DD"
      source: "BOC_VALET" | "CACHE";
    }
  | { ok: false; error: string };

/**
 * Inline FX-rate lookup for the transaction form. Called when the user
 * picks a non-CAD currency so the form can display the auto-fetched rate
 * with an override option.
 */
export async function lookupFxRateAction(
  currency: string,
  occurredAtIso: string,
): Promise<FxLookupActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  if (!currency || typeof currency !== "string") {
    return { ok: false, error: "Currency required." };
  }
  const date = new Date(occurredAtIso);
  if (isNaN(date.getTime())) {
    return { ok: false, error: "Invalid date." };
  }

  const result = await getFxRateToCad(currency, date);
  if (!result) {
    return { ok: false, error: `No BoC rate available for ${currency.toUpperCase()}.` };
  }

  return {
    ok: true,
    currency: result.currency,
    rate: result.rate,
    asOf: result.asOf.toISOString().slice(0, 10),
    source: result.source,
  };
}
