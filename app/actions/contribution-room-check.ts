"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRoomImpact } from "@/lib/canadian/contribution-room";

export type ContributionRoomImpactCheck =
  | { tracked: false }
  | {
      tracked: true;
      kind: "TFSA" | "RRSP" | "FHSA" | "RESP";
      year: number;
      roomAvailable: number;
      currentUsed: number;
      proposedAmount: number;
      remainingBefore: number;
      remainingAfter: number;
      wouldExceed: boolean;
    };

export async function checkContributionRoomImpactAction(
  brokerageId: string,
  isoDate: string,
  proposedAmount: number,
): Promise<ContributionRoomImpactCheck> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
    return { tracked: false };
  }

  const brokerage = await prisma.brokerage.findUnique({
    where: { id: brokerageId },
    select: { userId: true, kind: true },
  });
  if (!brokerage || brokerage.userId !== session.user.id) {
    return { tracked: false };
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return { tracked: false };
  const year = date.getUTCFullYear();

  const impact = await checkRoomImpact(
    session.user.id,
    brokerage.kind,
    year,
    proposedAmount,
  );
  if (!impact) return { tracked: false };

  return {
    tracked: true,
    kind: impact.kind,
    year: impact.year,
    roomAvailable: impact.roomAvailable,
    currentUsed: impact.currentUsed,
    proposedAmount: impact.proposedAmount,
    remainingBefore: impact.remainingBefore,
    remainingAfter: impact.remainingAfter,
    wouldExceed: impact.wouldExceed,
  };
}
