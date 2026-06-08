"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { translateRbcDi, type ImportableTx } from "@/lib/import/rbc-di";
import { getFxRateToCad } from "@/lib/marketdata/fx";
import type { BrokerageKind } from "@/generated/prisma";

export type PreviewImportableRow = ImportableTx & {
  /** Set when an existing tx looks like a duplicate (same brokerage + kind +
   *  ticker + ±1 day + ~price + ~qty). User can still elect to import. */
  duplicateOf?: {
    id: string;
    occurredAt: string;
    note: string | null;
  } | null;
  /** Within-batch index of an earlier row that looks like a duplicate of
   *  this one. Hint to the user that the file itself has dupes. */
  withinBatchDuplicateOfLine?: number | null;
};

export type PreviewImportResult =
  | {
      ok: true;
      filename: string;
      accountNumber: string;
      accountKind: BrokerageKind;
      /** Brokerage matched by name or kind heuristic. Null = user must pick. */
      suggestedBrokerageId: string | null;
      brokerages: { id: string; name: string; kind: BrokerageKind }[];
      importable: PreviewImportableRow[];
      skipped: { sourceLine: number; reason: string; hint: string }[];
      needsReview: { sourceLine: number; reason: string; hint: string; raw: Record<string, string> }[];
      errors: { sourceLine: number; error: string }[];
    }
  | { ok: false; error: string };

const QTY_TOL = 0.001;
const PRICE_TOL = 0.005;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse the CSV, translate to ImportableTx[], then layer two flavors of
 * duplicate detection on top:
 *
 *   1. Against existing rows in the DB (same brokerage + kind + ticker +
 *      ±1 day + ~price + ~qty). Catches re-imports.
 *   2. Against earlier rows within the SAME upload. Catches files that
 *      contain duplicate lines (rare but RBC has done it).
 *
 * Returns a structured result the UI can render row-by-row.
 */
export async function previewImportAction(args: {
  filename: string;
  fileText: string;
}): Promise<PreviewImportResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userId = session.user.id;

  let translation;
  try {
    translation = translateRbcDi(args.fileText);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Parse failed." };
  }

  const brokerages = await prisma.brokerage.findMany({
    where: { userId },
    select: { id: true, name: true, kind: true },
    orderBy: { createdAt: "asc" },
  });

  // Suggest a brokerage: exact name match against the account number, else
  // first brokerage with the same kind, else null.
  const acctNumStr = translation.accountNumber;
  const exact = brokerages.find((b) => b.name.includes(acctNumStr));
  const byKind = brokerages.find((b) => b.kind === translation.accountKind);
  const suggestedBrokerageId = exact?.id ?? byKind?.id ?? null;

  // Decorate importables with dup info. If we have a suggested brokerage,
  // we can check DB dups now; otherwise the user picks brokerage at commit
  // time and we re-check there.
  const importable: PreviewImportableRow[] = [];
  const seenWithin: { line: number; tx: ImportableTx }[] = [];

  for (const t of translation.importableTxs) {
    const withinDupLine = findWithinBatchDuplicate(t, seenWithin);
    let duplicateOf: PreviewImportableRow["duplicateOf"] = null;
    if (suggestedBrokerageId) {
      duplicateOf = await findDbDuplicate(userId, suggestedBrokerageId, t);
    }
    importable.push({
      ...t,
      duplicateOf,
      withinBatchDuplicateOfLine: withinDupLine,
    });
    seenWithin.push({ line: t.sourceLine, tx: t });
  }

  return {
    ok: true,
    filename: args.filename,
    accountNumber: translation.accountNumber,
    accountKind: translation.accountKind,
    suggestedBrokerageId,
    brokerages,
    importable,
    skipped: translation.skipped.map((s) => ({
      sourceLine: s.sourceLine,
      reason: s.reason,
      hint: s.hint,
    })),
    needsReview: translation.needsReview.map((r) => ({
      sourceLine: r.sourceLine,
      reason: r.reason,
      hint: r.hint,
      raw: r.raw,
    })),
    errors: translation.errors.map((e) => ({
      sourceLine: e.sourceLine,
      error: e.error,
    })),
  };
}

export type CommitImportInput = {
  filename: string;
  brokerageId: string;
  /** sourceLine values from the preview the user wants to import. Lets the
   *  UI exclude rows the user marked as duplicates or wants to skip. */
  acceptedSourceLines: number[];
  /** The original CSV text — we re-parse instead of trusting the client. */
  fileText: string;
};

export type CommitImportResult =
  | {
      ok: true;
      importBatchId: string;
      created: number;
      skippedAtCommit: number;
    }
  | { ok: false; error: string };

export async function commitImportAction(
  args: CommitImportInput,
): Promise<CommitImportResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userId = session.user.id;

  // Verify the brokerage belongs to this user.
  const brokerage = await prisma.brokerage.findUnique({
    where: { id: args.brokerageId },
    select: { id: true, userId: true },
  });
  if (!brokerage || brokerage.userId !== userId) {
    return { ok: false, error: "Brokerage not found." };
  }

  // Re-parse server-side. Never trust client-shaped data for a write path.
  let translation;
  try {
    translation = translateRbcDi(args.fileText);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Parse failed." };
  }

  const acceptedSet = new Set(args.acceptedSourceLines);
  const accepted = translation.importableTxs.filter((t) => acceptedSet.has(t.sourceLine));
  if (accepted.length === 0) {
    return { ok: false, error: "Nothing to import — no rows accepted." };
  }

  // FX rate enrichment. Three cases need a rate captured:
  //   1. Non-CAD tx (currency='USD' etc.) — straightforward FX-to-CAD.
  //   2. CAD-tagged tx on a USD-listed stock (RBC pre-converted the
  //      settlement to CAD for a Canadian-account holding). The CAD price
  //      stays as-is (broker's actual settlement, CRA-correct basis), but
  //      we capture USD/CAD at trade date so downstream FX-exposure and
  //      FTC accounting can reconstruct USD-equivalent values.
  // Sequential to avoid hammering BoC.
  const fxByKey = new Map<string, number | null>();
  for (const tx of accepted) {
    const needs = fxLookupNeed(tx);
    if (!needs) continue;
    const key = `${needs.currency}:${tx.occurredAt.toISOString().slice(0, 10)}`;
    if (fxByKey.has(key)) continue;
    const lookup = await getFxRateToCad(needs.currency, tx.occurredAt);
    fxByKey.set(key, lookup?.rate ?? null);
  }

  // Wrap in a transaction so a partial failure doesn't leave half a batch.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          userId,
          brokerageId: args.brokerageId,
          source: "RBC_DI",
          sourceFilename: args.filename,
          transactionCount: 0, // updated below
          skippedCount: translation.importableTxs.length - accepted.length,
          notes: buildImportNotes(translation),
        },
      });

      const rows = accepted.map((t) => {
        const needs = fxLookupNeed(t);
        const fxKey = needs
          ? `${needs.currency}:${t.occurredAt.toISOString().slice(0, 10)}`
          : null;
        const fx = fxKey ? (fxByKey.get(fxKey) ?? null) : null;
        return {
          userId,
          brokerageId: args.brokerageId,
          importBatchId: batch.id,
          ticker: t.ticker,
          kind: t.kind,
          currency: t.currency,
          fxRateToCad: fx,
          dividendType: t.kind === "DIVIDEND" ? t.dividendType : null,
          // SELL rows from import default to DISCRETIONARY — RBC doesn't
          // record intent. User can edit later.
          reasonCode: t.kind === "SELL" ? ("DISCRETIONARY" as const) : null,
          isDrip: false,
          quantity: t.quantity,
          price: t.price,
          fees: t.fees,
          occurredAt: t.occurredAt,
          note: t.note,
          splitRatio: null,
        };
      });

      await tx.transaction.createMany({ data: rows });

      const updated = await tx.importBatch.update({
        where: { id: batch.id },
        data: { transactionCount: rows.length },
        select: { id: true },
      });
      return { id: updated.id, count: rows.length };
    });

    revalidatePath("/");
    revalidatePath("/portfolio");
    revalidatePath("/portfolio");
    revalidatePath("/settings");
    revalidatePath("/settings/import");

    return {
      ok: true,
      importBatchId: result.id,
      created: result.count,
      skippedAtCommit: translation.importableTxs.length - accepted.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Commit failed.",
    };
  }
}

export type RollbackImportResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string };

export async function rollbackImportAction(
  importBatchId: string,
): Promise<RollbackImportResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const batch = await prisma.importBatch.findUnique({
    where: { id: importBatchId },
    select: { id: true, userId: true },
  });
  if (!batch || batch.userId !== session.user.id) {
    return { ok: false, error: "Import batch not found." };
  }

  // Delete the transactions first, then the batch. Order matters so the FK
  // doesn't keep dangling rows visible mid-rollback.
  const result = await prisma.$transaction(async (tx) => {
    const del = await tx.transaction.deleteMany({
      where: { importBatchId, userId: session.user.id },
    });
    await tx.importBatch.delete({ where: { id: importBatchId } });
    return del.count;
  });

  revalidatePath("/");
  revalidatePath("/portfolio");
  revalidatePath("/portfolio");
  revalidatePath("/settings");
  revalidatePath("/settings/import");

  return { ok: true, deleted: result };
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function findDbDuplicate(
  userId: string,
  brokerageId: string,
  t: ImportableTx,
): Promise<PreviewImportableRow["duplicateOf"]> {
  const rangeStart = new Date(t.occurredAt.getTime() - DAY_MS);
  const rangeEnd = new Date(t.occurredAt.getTime() + DAY_MS);
  const candidates = await prisma.transaction.findMany({
    where: {
      userId,
      brokerageId,
      kind: t.kind,
      ticker: t.ticker,
      occurredAt: { gte: rangeStart, lte: rangeEnd },
    },
    select: { id: true, quantity: true, price: true, occurredAt: true, note: true },
    take: 5,
  });
  for (const c of candidates) {
    const cQty = c.quantity.toNumber();
    const cPrice = c.price.toNumber();
    if (!withinTolerance(cQty, t.quantity, QTY_TOL)) continue;
    if (!withinTolerance(cPrice, t.price, PRICE_TOL)) continue;
    return { id: c.id, occurredAt: c.occurredAt.toISOString(), note: c.note };
  }
  return null;
}

function findWithinBatchDuplicate(
  t: ImportableTx,
  earlier: { line: number; tx: ImportableTx }[],
): number | null {
  for (const e of earlier) {
    if (e.tx.kind !== t.kind) continue;
    if (e.tx.ticker !== t.ticker) continue;
    if (Math.abs(e.tx.occurredAt.getTime() - t.occurredAt.getTime()) > DAY_MS) continue;
    if (!withinTolerance(e.tx.quantity, t.quantity, QTY_TOL)) continue;
    if (!withinTolerance(e.tx.price, t.price, PRICE_TOL)) continue;
    return e.line;
  }
  return null;
}

function withinTolerance(a: number, b: number, rel: number): boolean {
  if (a === 0 && b === 0) return true;
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / base < rel;
}

function isUsdListed(ticker: string): boolean {
  return !/\.(TO|V|NE|CN)$/.test(ticker.toUpperCase());
}

/**
 * Returns the foreign currency whose CAD rate we need to capture, or null
 * if no FX lookup is needed for this row. CAD on a CAD-listed ticker → no
 * lookup. CAD on a USD-listed ticker → look up USD (RBC pre-converted the
 * settlement). Non-CAD → look up the row's currency.
 */
function fxLookupNeed(t: ImportableTx): { currency: string } | null {
  if (t.currency !== "CAD") return { currency: t.currency };
  if (t.ticker && isUsdListed(t.ticker)) return { currency: "USD" };
  return null;
}

function buildImportNotes(translation: ReturnType<typeof translateRbcDi>): string {
  const parts: string[] = [];
  if (translation.skipped.length > 0) parts.push(`${translation.skipped.length} skipped`);
  if (translation.needsReview.length > 0) parts.push(`${translation.needsReview.length} need review`);
  if (translation.errors.length > 0) parts.push(`${translation.errors.length} parse errors`);
  return parts.length > 0 ? parts.join(" · ") : "Clean import";
}
