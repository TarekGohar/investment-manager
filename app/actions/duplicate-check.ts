"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { TransactionKind } from "@/generated/prisma";

export type DuplicateMatch = {
  id: string;
  kind: TransactionKind;
  ticker: string | null;
  quantity: number;
  price: number;
  occurredAt: string; // ISO date
  brokerageName: string;
  similarity:
    | { exactDate: true; exactQty: true; exactPrice: true }
    | { exactDate: boolean; exactQty: boolean; exactPrice: boolean };
};

export type DuplicateCheckResult =
  | { ok: true; matches: DuplicateMatch[] }
  | { ok: false; error: string };

const DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000; // ±1 day
const QTY_REL_TOLERANCE = 0.001; // ±0.1%
const PRICE_REL_TOLERANCE = 0.005; // ±0.5%

/**
 * Pre-submit duplicate check for the transaction form. Returns existing
 * transactions that are similar enough to be suspected duplicates — same
 * brokerage, same kind, same ticker, within ±1 day, within ±0.1% qty,
 * within ±0.5% price. The form shows them as a warning; the user can
 * proceed anyway.
 *
 * Returns at most 3 matches to keep the warning UI reasonable.
 */
export async function checkDuplicateTransactionAction(args: {
  brokerageId: string;
  kind: TransactionKind;
  ticker: string | null;
  quantity: number;
  price: number;
  occurredAtIso: string;
  /** Used when editing — exclude this row from the dup search. */
  excludeId?: string;
}): Promise<DuplicateCheckResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const occurredAt = new Date(args.occurredAtIso);
  if (isNaN(occurredAt.getTime())) {
    return { ok: false, error: "Invalid date." };
  }

  const rangeStart = new Date(occurredAt.getTime() - DATE_TOLERANCE_MS);
  const rangeEnd = new Date(occurredAt.getTime() + DATE_TOLERANCE_MS);

  const candidates = await prisma.transaction.findMany({
    where: {
      userId: session.user.id,
      brokerageId: args.brokerageId,
      kind: args.kind,
      ticker: args.ticker, // null matches null (cash flows)
      occurredAt: { gte: rangeStart, lte: rangeEnd },
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
    },
    include: { brokerage: { select: { name: true } } },
    orderBy: { occurredAt: "desc" },
    take: 10,
  });

  const matches: DuplicateMatch[] = [];
  for (const c of candidates) {
    const cQty = c.quantity.toNumber();
    const cPrice = c.price.toNumber();
    const exactDate =
      Math.abs(c.occurredAt.getTime() - occurredAt.getTime()) < 60 * 60 * 1000;
    const exactQty =
      args.quantity === 0
        ? cQty === 0
        : Math.abs(cQty - args.quantity) / Math.max(args.quantity, 1e-9) <
          QTY_REL_TOLERANCE;
    const exactPrice =
      args.price === 0
        ? cPrice === 0
        : Math.abs(cPrice - args.price) / Math.max(args.price, 1e-9) <
          PRICE_REL_TOLERANCE;

    // Only flag if qty AND price are similar (date is already in ±1d range).
    if (!exactQty || !exactPrice) continue;

    matches.push({
      id: c.id,
      kind: c.kind,
      ticker: c.ticker,
      quantity: cQty,
      price: cPrice,
      occurredAt: c.occurredAt.toISOString(),
      brokerageName: c.brokerage.name,
      similarity: { exactDate, exactQty, exactPrice },
    });
    if (matches.length >= 3) break;
  }

  return { ok: true, matches };
}
