"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cseResolveListing } from "@/lib/marketdata/cse";
import { lookupCik } from "@/lib/filings/edgar";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve a CSE listing from a URL the user pasted, e.g.
 * "https://thecse.com/en/listings/life-sciences/mountain-valley-md-holdings-inc",
 * and cache the resulting (ticker, issuerId, slug) so filings work.
 */
export async function resolveAndSaveCseListingAction(input: {
  ticker: string;
  url: string;
}): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) return { ok: false, error: "Ticker is required." };

  const listing = await cseResolveListing(input.url);
  if (!listing) {
    return {
      ok: false,
      error:
        "Couldn't parse a CSE listing from that URL. Make sure you pasted a thecse.com listing page (e.g. /en/listings/<sector>/<company-slug>).",
    };
  }

  await prisma.tickerListing.upsert({
    where: { ticker },
    update: {
      exchange: "CSE",
      name: listing.name,
      cseIssuerId: listing.issuerId,
      cseSlug: listing.slug,
    },
    create: {
      ticker,
      exchange: "CSE",
      name: listing.name,
      cseIssuerId: listing.issuerId,
      cseSlug: listing.slug,
    },
  });

  revalidatePath(`/positions/${ticker}`);
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * For US-listed tickers, populate the cached CIK so we don't hit EDGAR's
 * company_tickers.json on every request.
 */
export async function resolveAndSaveEdgarListingAction(input: {
  ticker: string;
}): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) return { ok: false, error: "Ticker is required." };

  const r = await lookupCik(ticker);
  if (!r) {
    return { ok: false, error: `No EDGAR CIK found for ${ticker}.` };
  }

  await prisma.tickerListing.upsert({
    where: { ticker },
    update: { exchange: "OTHER", name: r.title, cik: r.cik },
    create: { ticker, exchange: "OTHER", name: r.title, cik: r.cik },
  });

  revalidatePath(`/positions/${ticker}`);
  return { ok: true };
}
