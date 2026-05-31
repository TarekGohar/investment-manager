"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function toggleWatchlist(rawTicker: string): Promise<{ watched: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) return { watched: false };

  const existing = await prisma.watchlistItem.findUnique({
    where: { userId_ticker: { userId: session.user.id, ticker } },
  });

  let watched: boolean;
  if (existing) {
    await prisma.watchlistItem.delete({ where: { id: existing.id } });
    watched = false;
  } else {
    await prisma.watchlistItem.create({
      data: { userId: session.user.id, ticker },
    });
    watched = true;
  }

  revalidatePath(`/positions/${ticker}`);
  revalidatePath("/watchlist");
  return { watched };
}

export async function removeFromWatchlist(rawTicker: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const ticker = rawTicker.trim().toUpperCase();
  await prisma.watchlistItem.deleteMany({
    where: { userId: session.user.id, ticker },
  });

  revalidatePath(`/positions/${ticker}`);
  revalidatePath("/watchlist");
}
