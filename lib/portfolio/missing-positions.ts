import "server-only";
import { prisma } from "@/lib/prisma";
import type { BrokerageKind } from "@/generated/prisma";

/**
 * A position the user receives dividends on (per brokerage) but has no
 * recorded BUY or TRANSFER_IN for. Typically caused by:
 *  - RBC DI Activity CSV only covering the last 15 months — the original
 *    BUYs are older and weren't in any import
 *  - Hand-entered dividends on a position the user forgot to record an
 *    opening balance for
 *
 * The hint quantity comes from parsing RBC's dividend descriptions: each
 * one looks like "DIV - ROYAL BANK OF CANADA CASH DIV ON 10 SHS REC ...".
 * We pick the most recent dividend's share count.
 */
export type MissingPosition = {
  ticker: string;
  brokerageId: string;
  brokerageName: string;
  brokerageKind: BrokerageKind;
  currency: string;
  dividendCount: number;
  /** Parsed from "ON N SHS" in the most recent dividend's note, if any. */
  hintedQuantity: number | null;
  /** Earliest dividend date for this (ticker, brokerage) — useful as a
   *  default opening date for the synthetic TRANSFER_IN. */
  earliestDividendDate: Date;
  /** Most recent dividend's gross amount, for the user's reference. */
  latestDividendAmount: number;
};

const SHS_RE = /ON\s+([0-9,]+(?:\.[0-9]+)?)\s+SHS/i;

function parseSharesFromNote(note: string | null): number | null {
  if (!note) return null;
  const m = note.match(SHS_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function findMissingPositions(userId: string): Promise<MissingPosition[]> {
  // Pull all transactions with their brokerage info. The dataset is small
  // (one user, low thousands max) so we do this in memory rather than
  // crafting a fancy SQL aggregation.
  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      ticker: { not: null },
      kind: { in: ["BUY", "SELL", "DIVIDEND", "TRANSFER_IN", "TRANSFER_OUT"] },
    },
    include: { brokerage: { select: { id: true, name: true, kind: true } } },
    orderBy: { occurredAt: "asc" },
  });

  type Bucket = {
    ticker: string;
    brokerageId: string;
    brokerageName: string;
    brokerageKind: BrokerageKind;
    currency: string;
    hasOpening: boolean;
    dividends: { occurredAt: Date; price: number; note: string | null }[];
  };
  const buckets = new Map<string, Bucket>();

  for (const t of txs) {
    if (!t.ticker) continue;
    const key = `${t.brokerageId}|${t.ticker}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        ticker: t.ticker,
        brokerageId: t.brokerageId,
        brokerageName: t.brokerage.name,
        brokerageKind: t.brokerage.kind,
        currency: t.currency,
        hasOpening: false,
        dividends: [],
      };
      buckets.set(key, b);
    }
    if (t.kind === "BUY" || t.kind === "TRANSFER_IN") b.hasOpening = true;
    if (t.kind === "DIVIDEND") {
      b.dividends.push({
        occurredAt: t.occurredAt,
        price: t.price.toNumber(),
        note: t.note,
      });
    }
  }

  const out: MissingPosition[] = [];
  for (const b of buckets.values()) {
    if (b.hasOpening) continue;
    if (b.dividends.length === 0) continue;
    const sorted = [...b.dividends].sort(
      (a, c) => c.occurredAt.getTime() - a.occurredAt.getTime(),
    );
    const latest = sorted[0];
    // Walk newest → oldest looking for any dividend whose note still has
    // the "ON N SHS" hint. Older imports may have overwritten the note
    // with an FWT reminder; we don't want to lose the hint in those cases.
    let hintedQuantity: number | null = null;
    for (const d of sorted) {
      const hint = parseSharesFromNote(d.note);
      if (hint != null) {
        hintedQuantity = hint;
        break;
      }
    }
    out.push({
      ticker: b.ticker,
      brokerageId: b.brokerageId,
      brokerageName: b.brokerageName,
      brokerageKind: b.brokerageKind,
      currency: b.currency,
      dividendCount: b.dividends.length,
      hintedQuantity,
      earliestDividendDate: b.dividends[b.dividends.length - 1].occurredAt,
      latestDividendAmount: latest.price,
    });
  }

  return out.sort((a, b) =>
    a.brokerageName === b.brokerageName
      ? a.ticker.localeCompare(b.ticker)
      : a.brokerageName.localeCompare(b.brokerageName),
  );
}
