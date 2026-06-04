import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getMonthlyTokenUsage } from "@/lib/ai/queries";

export const dynamic = "force-dynamic";

/**
 * Current-month AI spend for the signed-in user. Powers the live navbar
 * counter, which refetches this after each AI interaction (see
 * AI_USAGE_REFRESH_EVENT) so the number updates without a full route refresh.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const usage = await getMonthlyTokenUsage(session.user.id);
  return Response.json(usage, {
    headers: { "Cache-Control": "no-store" },
  });
}
