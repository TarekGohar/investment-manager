"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listTransactions } from "@/lib/portfolio/queries";
import { wouldCreateSuperficialLoss } from "@/lib/canadian/superficial-loss";

export type SuperficialLossCheck =
  | { violates: false }
  | {
      violates: true;
      ticker: string;
      saleDate: string; // ISO
      lossAmount: number;
      daysRemaining: number;
      windowEndsAt: string;
    };

export async function checkSuperficialLossAction(
  ticker: string,
  proposedIsoDate: string,
): Promise<SuperficialLossCheck> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const cleanTicker = ticker.trim().toUpperCase();
  if (!cleanTicker) return { violates: false };

  const date = new Date(proposedIsoDate);
  if (Number.isNaN(date.getTime())) return { violates: false };

  const transactions = await listTransactions(session.user.id);
  const result = wouldCreateSuperficialLoss(cleanTicker, date, transactions);
  if (!result.violates || !result.sale) return { violates: false };

  return {
    violates: true,
    ticker: cleanTicker,
    saleDate: result.sale.saleDate.toISOString(),
    lossAmount: result.sale.lossAmount,
    daysRemaining: result.sale.daysRemaining,
    windowEndsAt: result.sale.windowEndsAt.toISOString(),
  };
}
