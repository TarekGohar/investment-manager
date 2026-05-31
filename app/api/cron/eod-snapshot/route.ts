import "server-only";
import { prisma } from "@/lib/prisma";
import { writeDailySnapshot } from "@/lib/portfolio/snapshots";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily NAV snapshot. Runs at 21:30 UTC after refresh-quotes has populated
 * the cache for the close. Idempotent per (user, date) — re-running on the
 * same calendar day overwrites the row, which is intentional for late-day
 * trade entry.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true } });

  let written = 0;
  const errors: string[] = [];
  for (const u of users) {
    try {
      const result = await writeDailySnapshot(u.id);
      if (result.written) written++;
    } catch (err) {
      errors.push(`${u.id}: ${(err as Error).message}`);
    }
  }

  return Response.json({
    ok: true,
    users: users.length,
    snapshotsWritten: written,
    errors,
    at: new Date().toISOString(),
  });
}
