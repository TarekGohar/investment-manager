"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  clearConversation,
  createConversation,
  getLatestConversation,
} from "@/lib/ai/queries";

export async function createChatAction(rawScope: string): Promise<{ id: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = normalizeScope(rawScope);
  const { id } = await createConversation(session.user.id, scope);
  revalidatePath("/chat");
  return { id };
}

export async function clearChatAction(rawScope: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = normalizeScope(rawScope);
  const conv = await getLatestConversation(session.user.id, scope);
  if (conv) {
    await clearConversation(conv.id);
  }

  const path = scope === "portfolio" ? "/chat" : `/chat?ticker=${scope}`;
  revalidatePath(path);
}

export async function deleteChatAction(rawScope: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = normalizeScope(rawScope);
  await prisma.aIConversation.deleteMany({
    where: { userId: session.user.id, scope: scope === "portfolio" ? "portfolio" : scope },
  });

  const path = scope === "portfolio" ? "/chat" : `/chat?ticker=${scope}`;
  revalidatePath(path);
}

function normalizeScope(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "portfolio") return "portfolio";
  const candidate = trimmed.toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(candidate)) return "portfolio";
  return candidate;
}
