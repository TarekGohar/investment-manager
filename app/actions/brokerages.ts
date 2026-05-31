"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BrokerageKind } from "@/generated/prisma";

const NameSchema = z.string().trim().min(1, "Name is required.").max(48);
const CurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code (e.g. CAD).")
  .default("CAD");
const KindSchema = z.nativeEnum(BrokerageKind);

type ActionResult = { ok: true } | { ok: false; error: string };

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/portfolio");
}

export async function createBrokerageAction(formData: FormData): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const name = NameSchema.safeParse(formData.get("name"));
  const currency = CurrencySchema.safeParse(formData.get("currency") ?? "CAD");
  const kind = KindSchema.safeParse(formData.get("kind") ?? "NON_REGISTERED");
  if (!name.success) return { ok: false, error: name.error.issues[0].message };
  if (!currency.success) return { ok: false, error: currency.error.issues[0].message };
  if (!kind.success) return { ok: false, error: "Invalid account kind." };

  const existing = await prisma.brokerage.findUnique({
    where: { userId_name: { userId: session.user.id, name: name.data } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "A brokerage with that name already exists." };

  await prisma.brokerage.create({
    data: {
      userId: session.user.id,
      name: name.data,
      currency: currency.data,
      kind: kind.data,
    },
  });

  refresh();
  return { ok: true };
}

export async function renameBrokerageAction(
  id: string,
  newName: string,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const parsed = NameSchema.safeParse(newName);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await prisma.brokerage.findUnique({
    where: { id },
    select: { userId: true, name: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, error: "Brokerage not found." };
  }

  if (existing.name === parsed.data) {
    return { ok: true };
  }

  const dupe = await prisma.brokerage.findUnique({
    where: { userId_name: { userId: session.user.id, name: parsed.data } },
    select: { id: true },
  });
  if (dupe && dupe.id !== id) {
    return { ok: false, error: "A brokerage with that name already exists." };
  }

  await prisma.brokerage.update({ where: { id }, data: { name: parsed.data } });
  refresh();
  return { ok: true };
}

export async function setBrokerageKindAction(
  id: string,
  newKind: string,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const parsed = KindSchema.safeParse(newKind);
  if (!parsed.success) return { ok: false, error: "Invalid account kind." };

  const existing = await prisma.brokerage.findUnique({
    where: { id },
    select: { userId: true, kind: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, error: "Brokerage not found." };
  }

  if (existing.kind === parsed.data) return { ok: true };

  await prisma.brokerage.update({ where: { id }, data: { kind: parsed.data } });
  refresh();
  return { ok: true };
}

export async function deleteBrokerageAction(id: string): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const existing = await prisma.brokerage.findUnique({
    where: { id },
    select: { userId: true, _count: { select: { transactions: true } } },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, error: "Brokerage not found." };
  }
  if (existing._count.transactions > 0) {
    return {
      ok: false,
      error: `Move or delete the ${existing._count.transactions} transaction${
        existing._count.transactions === 1 ? "" : "s"
      } in this brokerage first.`,
    };
  }

  await prisma.brokerage.delete({ where: { id } });
  refresh();
  return { ok: true };
}
