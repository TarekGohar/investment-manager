"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { mailgunStatus, sendTestEmail } from "@/lib/mailgun";

type ActionResult = { ok: true; status: "sent" | "console-fallback" } | { ok: false; error: string };

export async function sendTestEmailAction(): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const status = mailgunStatus();
  try {
    await sendTestEmail({ to: session.user.email });
    return { ok: true, status: status.configured ? "sent" : "console-fallback" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return { ok: false, error: message };
  }
}
