import "server-only";
import { prisma } from "@/lib/prisma";
import { classifyHeadline } from "@/lib/ai/news-classifier";
import { getUserPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_ITEMS_PER_RUN = 80;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Identify tickers worth classifying — held by anyone whose preference allows it
  const users = await prisma.user.findMany({ select: { id: true } });
  const enabledUserIds = new Set<string>();
  for (const u of users) {
    const prefs = await getUserPreferences(u.id);
    if (prefs.aiNewsClassification) enabledUserIds.add(u.id);
  }
  if (enabledUserIds.size === 0) {
    return Response.json({ ok: true, classified: 0, skipped: "no users opted in" });
  }

  const [txTickers, watchTickers, alertTickers] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: { in: Array.from(enabledUserIds) } },
      select: { ticker: true },
      distinct: ["ticker"],
    }),
    prisma.watchlistItem.findMany({
      where: { userId: { in: Array.from(enabledUserIds) } },
      select: { ticker: true },
    }),
    prisma.alert.findMany({
      where: {
        userId: { in: Array.from(enabledUserIds) },
        enabled: true,
        ticker: { not: null },
      },
      select: { ticker: true },
      distinct: ["ticker"],
    }),
  ]);

  const tickerSet = new Set<string>();
  for (const t of txTickers) tickerSet.add(t.ticker);
  for (const t of watchTickers) tickerSet.add(t.ticker);
  for (const t of alertTickers) if (t.ticker) tickerSet.add(t.ticker);
  if (tickerSet.size === 0) {
    return Response.json({ ok: true, classified: 0, skipped: "no tickers" });
  }

  // Unclassified news for these tickers, freshest first
  const items = await prisma.newsItem.findMany({
    where: {
      ticker: { in: Array.from(tickerSet) },
      aiSeverity: null,
      // Only classify items from the last 7 days; older stuff is stale
      publishedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    orderBy: { publishedAt: "desc" },
    take: MAX_ITEMS_PER_RUN,
  });

  let classified = 0;
  for (const item of items) {
    try {
      const severity = await classifyHeadline({
        ticker: item.ticker,
        headline: item.headline,
        summary: item.summary,
      });
      await prisma.newsItem.update({
        where: { id: item.id },
        data: { aiSeverity: severity, classifiedAt: new Date() },
      });
      classified += 1;
    } catch (err) {
      console.error(`[cron/classify-news] item ${item.id} failed:`, err);
    }
  }

  return Response.json({
    ok: true,
    candidates: items.length,
    classified,
    tickers: tickerSet.size,
    at: new Date().toISOString(),
  });
}
