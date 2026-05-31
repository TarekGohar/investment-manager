"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSedarSession, testSedarSession } from "@/lib/filings/sedar-plus";

type ActionResult = { ok: true } | { ok: false; error: string };

const KNOWN_SOURCES = ["SEDAR_PLUS"] as const;
type Source = (typeof KNOWN_SOURCES)[number];

export async function saveExternalCookieSessionAction(input: {
  source: string;
  cookieHeader: string;
  userAgent?: string;
  notes?: string;
}): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const source = input.source as Source;
  if (!KNOWN_SOURCES.includes(source)) {
    return { ok: false, error: `Unknown source: ${input.source}.` };
  }
  const cookieHeader = input.cookieHeader.trim();
  if (!cookieHeader || cookieHeader.length < 20) {
    return { ok: false, error: "Cookie header looks too short — paste the full Cookie value." };
  }
  if (cookieHeader.toLowerCase().startsWith("cookie:")) {
    return {
      ok: false,
      error: 'Drop the leading "Cookie:" prefix — just paste the value after the colon.',
    };
  }

  await prisma.externalCookieSession.upsert({
    where: { userId_source: { userId: session.user.id, source } },
    update: {
      cookieHeader,
      userAgent: input.userAgent?.trim() || null,
      notes: input.notes?.trim() || null,
    },
    create: {
      userId: session.user.id,
      source,
      cookieHeader,
      userAgent: input.userAgent?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteExternalCookieSessionAction(
  source: string,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  await prisma.externalCookieSession.deleteMany({
    where: { userId: session.user.id, source },
  });
  revalidatePath("/settings");
  return { ok: true };
}

export async function testSedarCookiesAction(): Promise<
  { ok: true; detail: string } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const stored = await getSedarSession(session.user.id);
  if (!stored) return { ok: false, error: "No SEDAR+ cookies saved yet." };

  const result = await testSedarSession(stored);
  if (result.ok) return { ok: true, detail: result.detail };
  return { ok: false, error: result.detail };
}
