import "server-only";
import { prisma } from "@/lib/prisma";
import { evaluateUserAlerts } from "@/lib/signals/evaluate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Find every user that has at least one enabled alert
  const userIds = (
    await prisma.alert.findMany({
      where: { enabled: true },
      select: { userId: true },
      distinct: ["userId"],
    })
  ).map((a) => a.userId);

  let totalEvaluated = 0;
  let totalFired = 0;
  for (const userId of userIds) {
    try {
      const result = await evaluateUserAlerts(userId);
      totalEvaluated += result.evaluated;
      totalFired += result.fired;
    } catch (err) {
      console.error(`[cron/run-alerts] user ${userId} failed:`, err);
    }
  }

  return Response.json({
    ok: true,
    users: userIds.length,
    evaluated: totalEvaluated,
    fired: totalFired,
    at: new Date().toISOString(),
  });
}
