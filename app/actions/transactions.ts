"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureDefaultBrokerage } from "@/lib/portfolio/queries";
import { getFxRateToCad } from "@/lib/marketdata/fx";
import { fulfillPlanIfMatchedAction } from "@/app/actions/planned-actions";

function refreshTransactionPaths(ticker: string | null) {
  revalidatePath("/");
  revalidatePath("/portfolio");
  revalidatePath("/portfolio");
  if (ticker) revalidatePath(`/positions/${ticker}`);
}

/**
 * Resolve the currency for a transaction: explicit form value > brokerage
 * default. Brokerages exist before any transactions, so this always finds
 * something.
 */
async function resolveCurrency(
  brokerageId: string,
  override: string | undefined,
): Promise<string> {
  if (override) return override.toUpperCase();
  const b = await prisma.brokerage.findUnique({
    where: { id: brokerageId },
    select: { currency: true },
  });
  return (b?.currency ?? "CAD").toUpperCase();
}

/**
 * Resolve the CAD-equivalent FX rate for this transaction. Returns null for
 * CAD rows (no FX needed). For non-CAD rows: honour explicit user override;
 * otherwise fetch from BoC Valet at trade date. Returns null if BoC fails —
 * the row still saves; the user can edit later.
 */
async function resolveFxRate(
  currency: string,
  occurredAt: Date,
  override: number | undefined,
): Promise<number | null> {
  if (currency === "CAD") return null;
  if (override != null && override > 0) return override;
  const result = await getFxRateToCad(currency, occurredAt);
  return result?.rate ?? null;
}

const Schema = z
  .object({
    ticker: z
      .string()
      .trim()
      .toUpperCase()
      .max(10)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    kind: z.enum([
      "BUY", "SELL", "DIVIDEND", "SPLIT", "TRANSFER_IN", "TRANSFER_OUT",
      "DEPOSIT", "WITHDRAWAL",
    ]),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(3)
      .optional(),
    dividendType: z
      .enum([
        "ELIGIBLE",
        "NON_ELIGIBLE",
        "INTEREST",
        "FOREIGN",
        "RETURN_OF_CAPITAL",
        "OTHER",
      ])
      .optional(),
    reasonCode: z
      .enum([
        "REBALANCE_DRIFT",
        "THESIS_INVALIDATED",
        "TLH_HARVEST",
        "TAX_PLANNING",
        "CASH_NEED",
        "DISCRETIONARY",
      ])
      .optional(),
    fxRateToCad: z.coerce.number().positive().optional(),
    isDrip: z
      .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
      .optional()
      .transform((v) => v === "on" || v === "true"),
    quantity: z.coerce.number().nonnegative().optional(),
    price: z.coerce.number().nonnegative().optional(),
    amount: z.coerce.number().nonnegative().optional(),
    splitRatio: z.coerce.number().positive().optional(),
    fees: z.coerce.number().nonnegative().default(0),
    occurredAt: z.coerce.date(),
    note: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null)),
    brokerageId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .superRefine((data, ctx) => {
    const isCashFlow = data.kind === "DEPOSIT" || data.kind === "WITHDRAWAL";
    if (!isCashFlow && !data.ticker) {
      ctx.addIssue({ code: "custom", path: ["ticker"], message: "Ticker is required." });
    }
    if (data.kind === "BUY" || data.kind === "SELL" || data.kind === "TRANSFER_IN" || data.kind === "TRANSFER_OUT") {
      if (!data.quantity || data.quantity <= 0) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity is required and must be > 0." });
      }
      if (data.price == null || data.price < 0) {
        ctx.addIssue({ code: "custom", path: ["price"], message: "Price is required." });
      }
    }
    if (data.kind === "DIVIDEND") {
      if (!data.amount || data.amount <= 0) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Dividend amount is required." });
      }
      if (!data.dividendType) {
        ctx.addIssue({
          code: "custom",
          path: ["dividendType"],
          message: "Dividend type is required — picks the right tax rate and slip box.",
        });
      }
    }
    if (data.kind === "DEPOSIT" || data.kind === "WITHDRAWAL") {
      if (!data.amount || data.amount <= 0) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount is required and must be > 0." });
      }
    }
    if (data.kind === "SPLIT") {
      if (!data.splitRatio || data.splitRatio <= 0) {
        ctx.addIssue({ code: "custom", path: ["splitRatio"], message: "Split ratio is required." });
      }
    }
    if (data.kind === "SELL" && !data.reasonCode) {
      ctx.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message:
          "Reason is required on sells — tells the coach when to stay quiet (TLH, rebalance) vs flag a possible mistake (panic sell, abandoned thesis).",
      });
    }
  });

export type CreateTxResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createTransactionAction(formData: FormData): Promise<CreateTxResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const raw = Object.fromEntries(formData);
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return { ok: false, error: msg };
  }
  const data = parsed.data;

  const brokerageId = await ensureDefaultBrokerage(session.user.id);

  let qty: number;
  let price: number;
  let splitRatio: number | null = null;

  switch (data.kind) {
    case "DIVIDEND":
      // Store dividend amount in `price`; qty = 1 so totals don't double count
      qty = 1;
      price = data.amount!;
      break;
    case "DEPOSIT":
    case "WITHDRAWAL":
      // Cash flow: amount in `price`, qty = 1, no ticker semantics.
      qty = 1;
      price = data.amount!;
      break;
    case "SPLIT":
      qty = 0;
      price = 0;
      splitRatio = data.splitRatio!;
      break;
    default:
      qty = data.quantity!;
      price = data.price!;
  }

  const effectiveBrokerageId = data.brokerageId ?? brokerageId;
  const currency = await resolveCurrency(effectiveBrokerageId, data.currency);
  const fxRateToCad = await resolveFxRate(currency, data.occurredAt, data.fxRateToCad);

  await prisma.transaction.create({
    data: {
      userId: session.user.id,
      brokerageId: effectiveBrokerageId,
      ticker: data.ticker,
      kind: data.kind,
      currency,
      fxRateToCad,
      dividendType: data.kind === "DIVIDEND" ? data.dividendType : null,
      reasonCode: data.kind === "SELL" ? data.reasonCode : null,
      isDrip: data.kind === "BUY" ? Boolean(data.isDrip) : false,
      quantity: qty,
      price,
      fees: data.fees,
      occurredAt: data.occurredAt,
      note: data.note,
      splitRatio,
    },
  });

  // Best-effort: if this SELL fulfills an open coaching plan, mark the
  // plan complete so it stops nagging on the dashboard.
  if (data.kind === "SELL" && data.reasonCode) {
    await fulfillPlanIfMatchedAction({
      userId: session.user.id,
      ticker: data.ticker,
      reasonCode: data.reasonCode,
    });
  }

  refreshTransactionPaths(data.ticker);
  return { ok: true };
}

export async function updateTransactionAction(
  id: string,
  formData: FormData,
): Promise<CreateTxResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const existing = await prisma.transaction.findUnique({
    where: { id },
    select: { userId: true, ticker: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, error: "Transaction not found." };
  }

  const raw = Object.fromEntries(formData);
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const data = parsed.data;

  let qty: number;
  let price: number;
  let splitRatio: number | null = null;
  switch (data.kind) {
    case "DIVIDEND":
      qty = 1;
      price = data.amount!;
      break;
    case "DEPOSIT":
    case "WITHDRAWAL":
      qty = 1;
      price = data.amount!;
      break;
    case "SPLIT":
      qty = 0;
      price = 0;
      splitRatio = data.splitRatio!;
      break;
    default:
      qty = data.quantity!;
      price = data.price!;
  }

  // If brokerage isn't specified, keep the existing one
  const brokerageId = data.brokerageId ?? (await ensureDefaultBrokerage(session.user.id));
  const currency = await resolveCurrency(brokerageId, data.currency);
  const fxRateToCad = await resolveFxRate(currency, data.occurredAt, data.fxRateToCad);

  await prisma.transaction.update({
    where: { id },
    data: {
      brokerageId,
      ticker: data.ticker,
      kind: data.kind,
      currency,
      fxRateToCad,
      dividendType: data.kind === "DIVIDEND" ? data.dividendType : null,
      reasonCode: data.kind === "SELL" ? data.reasonCode : null,
      isDrip: data.kind === "BUY" ? Boolean(data.isDrip) : false,
      quantity: qty,
      price,
      fees: data.fees,
      occurredAt: data.occurredAt,
      note: data.note,
      splitRatio,
    },
  });

  refreshTransactionPaths(existing.ticker);
  if (existing.ticker !== data.ticker) {
    refreshTransactionPaths(data.ticker);
  }
  return { ok: true };
}

export async function deleteTransactionAction(id: string): Promise<CreateTxResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const existing = await prisma.transaction.findUnique({ where: { id }, select: { userId: true, ticker: true } });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, error: "Transaction not found." };
  }

  await prisma.transaction.delete({ where: { id } });

  refreshTransactionPaths(existing.ticker);
  return { ok: true };
}
