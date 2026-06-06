"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROOM_KINDS, type RoomKind } from "@/lib/canadian/contribution-room";

type ActionResult = { ok: true } | { ok: false; error: string };

const MIN_YEAR = 2009; // TFSA introduction year — lower bound sanity check
const MAX_YEAR = 2100;

function isRoomKindString(value: string): value is RoomKind {
  return (ROOM_KINDS as string[]).includes(value);
}

export async function upsertContributionRoomAction(input: {
  kind: string;
  year: number;
  roomAvailable: number;
  notes?: string | null;
}): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  if (!isRoomKindString(input.kind)) {
    return { ok: false, error: "Unsupported account type for contribution room." };
  }
  if (
    !Number.isInteger(input.year) ||
    input.year < MIN_YEAR ||
    input.year > MAX_YEAR
  ) {
    return { ok: false, error: `Year must be between ${MIN_YEAR} and ${MAX_YEAR}.` };
  }
  if (!Number.isFinite(input.roomAvailable) || input.roomAvailable < 0) {
    return { ok: false, error: "Room available must be a non-negative number." };
  }

  await prisma.contributionRoom.upsert({
    where: {
      userId_kind_year: {
        userId: session.user.id,
        kind: input.kind,
        year: input.year,
      },
    },
    update: {
      roomAvailable: input.roomAvailable,
      notes: input.notes ?? null,
    },
    create: {
      userId: session.user.id,
      kind: input.kind,
      year: input.year,
      roomAvailable: input.roomAvailable,
      notes: input.notes ?? null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/review");
  return { ok: true };
}

export async function deleteContributionRoomAction(
  id: string,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const row = await prisma.contributionRoom.findUnique({ where: { id } });
  if (!row || row.userId !== session.user.id) {
    return { ok: false, error: "Not found." };
  }
  await prisma.contributionRoom.delete({ where: { id } });
  revalidatePath("/settings");
  revalidatePath("/review");
  return { ok: true };
}
