import "server-only";
import { prisma } from "@/lib/prisma";
import { generateDailyReview } from "@/lib/ai/reviews";
import { getUserPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Find every user that has at least one transaction (i.e., real portfolio)
  const userIds = (
    await prisma.transaction.findMany({
      select: { userId: true },
      distinct: ["userId"],
    })
  ).map((r) => r.userId);

  let generated = 0;
  let skipped = 0;
  for (const userId of userIds) {
    try {
      const prefs = await getUserPreferences(userId);
      if (!prefs.aiAutoDailyReview) {
        skipped += 1;
        continue;
      }
      const id = await generateDailyReview(userId);
      if (id) generated += 1;
    } catch (err) {
      console.error(`[cron/daily-review] user ${userId} failed:`, err);
    }
  }

  return Response.json({
    ok: true,
    users: userIds.length,
    generated,
    skipped,
    at: new Date().toISOString(),
  });
}
