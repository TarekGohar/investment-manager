import "server-only";
import { prisma } from "@/lib/prisma";
import type { BrokerageKind } from "@/generated/prisma";
import type { Tx } from "@/lib/portfolio/types";
import { listTransactions } from "@/lib/portfolio/queries";
import { isRegisteredKind } from "@/lib/portfolio/holdings";

/** Account types that have CRA contribution room. LIRA / RRIF do not accept new contributions. */
export type RoomKind = "TFSA" | "RRSP" | "FHSA" | "RESP";

export const ROOM_KINDS: RoomKind[] = ["TFSA", "RRSP", "FHSA", "RESP"];

export function isRoomKind(kind: BrokerageKind): kind is RoomKind {
  return (ROOM_KINDS as string[]).includes(kind);
}

export type ContributionRoomEntry = {
  id: string;
  kind: RoomKind;
  year: number;
  roomAvailable: number;
  notes: string | null;
};

export type ContributionRoomStatus = {
  kind: RoomKind;
  year: number;
  /** What the user entered from their NOA. Null = not provided. */
  roomAvailable: number | null;
  /**
   * Derived: sum of (quantity * price + fees) for BUY transactions in this
   * registered kind during this year. This is an approximation — see notes.
   */
  derivedUsed: number;
  /** roomAvailable - derivedUsed; null if no room entered. */
  remaining: number | null;
  /** Percentage of room used; null if no room entered. */
  utilization: number | null;
  /** True when derivedUsed exceeds roomAvailable. */
  overContributed: boolean;
};

export async function listContributionRooms(userId: string): Promise<ContributionRoomEntry[]> {
  const rows = await prisma.contributionRoom.findMany({
    where: { userId },
    orderBy: [{ year: "desc" }, { kind: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as RoomKind,
    year: r.year,
    roomAvailable: r.roomAvailable.toNumber(),
    notes: r.notes,
  }));
}

/**
 * Sum of DEPOSIT transactions per (kind, year) for TFSA / RRSP / FHSA /
 * RESP accounts. This is the CRA-correct definition of "contribution room
 * used": room is consumed when *cash is contributed* to the account, not
 * when you buy shares with already-contributed cash. A SELL that leaves
 * the cash in the account doesn't free room (TFSA withdrawals free room
 * the following year, but that's already reflected in the room number the
 * user enters from their NOA).
 *
 * BUY, SELL, DIVIDEND, SPLIT, TRANSFER_IN/OUT, and WITHDRAWAL are all
 * excluded — none of them consume new room.
 */
export function deriveUsedRoomByKindYear(transactions: Tx[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.kind !== "DEPOSIT") continue;
    if (!isRegisteredKind(tx.brokerageKind)) continue;
    if (!isRoomKind(tx.brokerageKind)) continue;
    const year = tx.occurredAt.getUTCFullYear();
    const key = `${tx.brokerageKind}:${year}`;
    // DEPOSIT stores the cash amount in `price`, qty = 1.
    out.set(key, (out.get(key) ?? 0) + tx.price);
  }
  return out;
}

export async function getContributionRoomStatus(
  userId: string,
  year: number,
): Promise<ContributionRoomStatus[]> {
  const [entries, transactions] = await Promise.all([
    listContributionRooms(userId),
    listTransactions(userId),
  ]);

  const used = deriveUsedRoomByKindYear(transactions);
  const entryByKey = new Map(entries.map((e) => [`${e.kind}:${e.year}`, e]));

  return ROOM_KINDS.map((kind): ContributionRoomStatus => {
    const key = `${kind}:${year}`;
    const entry = entryByKey.get(key) ?? null;
    const roomAvailable = entry ? entry.roomAvailable : null;
    const derivedUsed = used.get(key) ?? 0;
    const remaining = roomAvailable == null ? null : roomAvailable - derivedUsed;
    const utilization =
      roomAvailable == null || roomAvailable <= 0
        ? null
        : (derivedUsed / roomAvailable) * 100;
    return {
      kind,
      year,
      roomAvailable,
      derivedUsed,
      remaining,
      utilization,
      overContributed: remaining != null && remaining < 0,
    };
  });
}

/**
 * Would a prospective BUY exceed the user's remaining room? Used by the
 * transaction form for pre-trade warnings. Returns null if the brokerage
 * isn't a room-tracked kind, or the user hasn't entered room for that year.
 */
export async function checkRoomImpact(
  userId: string,
  kind: BrokerageKind,
  year: number,
  proposedAmount: number,
): Promise<
  | null
  | {
      kind: RoomKind;
      year: number;
      roomAvailable: number;
      currentUsed: number;
      proposedAmount: number;
      remainingBefore: number;
      remainingAfter: number;
      wouldExceed: boolean;
    }
> {
  if (!isRoomKind(kind)) return null;
  const statuses = await getContributionRoomStatus(userId, year);
  const status = statuses.find((s) => s.kind === kind);
  if (!status || status.roomAvailable == null) return null;
  const remainingBefore = status.remaining ?? status.roomAvailable;
  const remainingAfter = remainingBefore - proposedAmount;
  return {
    kind,
    year,
    roomAvailable: status.roomAvailable,
    currentUsed: status.derivedUsed,
    proposedAmount,
    remainingBefore,
    remainingAfter,
    wouldExceed: remainingAfter < 0,
  };
}
