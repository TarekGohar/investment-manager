"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluateUserAlerts } from "@/lib/signals/evaluate";
import { AlertRule, AlertScope } from "@/generated/prisma";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

const Schema = z
  .object({
    rule: z.enum(["PRICE_MOVE", "DRAWDOWN", "CONCENTRATION"]),
    scope: z.enum(["PORTFOLIO", "HOLDING", "TICKER"]),
    ticker: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .transform((v) => (v ? v : null)),
    thresholdPct: z.coerce.number().positive().max(1000),
    emailChannel: z.coerce.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.scope === "TICKER" && !data.ticker) {
      ctx.addIssue({
        code: "custom",
        path: ["ticker"],
        message: "Pick a ticker for ticker-scoped alerts.",
      });
    }
    if (data.rule === "CONCENTRATION" && data.scope !== "PORTFOLIO") {
      ctx.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Concentration alerts only support the portfolio scope.",
      });
    }
    if (data.rule === "DRAWDOWN" && data.scope === "PORTFOLIO") {
      ctx.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Drawdown alerts must be scoped to a ticker or all holdings.",
      });
    }
  });

function refresh() {
  revalidatePath("/alerts");
  revalidatePath("/", "layout");
}

export async function createAlertAction(formData: FormData): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const raw = Object.fromEntries(formData);
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const data = parsed.data;

  await prisma.alert.create({
    data: {
      userId: session.user.id,
      rule: data.rule as AlertRule,
      scope: data.scope as AlertScope,
      ticker: data.ticker,
      params: { thresholdPct: data.thresholdPct },
      channels: data.emailChannel ? ["IN_APP", "EMAIL"] : ["IN_APP"],
    },
  });

  refresh();
  return { ok: true };
}

export async function toggleAlertAction(id: string): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const existing = await prisma.alert.findUnique({
    where: { id },
    select: { userId: true, enabled: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, error: "Alert not found." };
  }
  await prisma.alert.update({
    where: { id },
    data: { enabled: !existing.enabled },
  });
  refresh();
  return { ok: true };
}

export async function deleteAlertAction(id: string): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const existing = await prisma.alert.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, error: "Alert not found." };
  }
  await prisma.alert.delete({ where: { id } });
  refresh();
  return { ok: true };
}

export async function runAlertsNowAction(): Promise<ActionResult<{ fired: number }>> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const result = await evaluateUserAlerts(session.user.id);
  refresh();
  return { ok: true, data: { fired: result.fired } };
}
