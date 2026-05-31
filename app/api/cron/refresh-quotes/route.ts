import "server-only";
import { prisma } from "@/lib/prisma";
import { getQuotes } from "@/lib/marketdata";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Warm the Quote cache for every ticker the user base touches — current
 * holdings + watchlist + ticker-scoped alerts. Runs before run-alerts so the
 * evaluator works against fresh data.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [txTickers, watch, alertTickers] = await Promise.all([
    prisma.transaction.findMany({
      where: { kind: { notIn: ["DEPOSIT", "WITHDRAWAL"] } },
      select: { ticker: true },
      distinct: ["ticker"],
    }),
    prisma.watchlistItem.findMany({
      select: { ticker: true },
    }),
    prisma.alert.findMany({
      where: { enabled: true, ticker: { not: null } },
      select: { ticker: true },
      distinct: ["ticker"],
    }),
  ]);

  const tickers = new Set<string>();
  for (const t of txTickers) tickers.add(t.ticker);
  for (const w of watch) tickers.add(w.ticker);
  for (const a of alertTickers) if (a.ticker) tickers.add(a.ticker);

  if (tickers.size === 0) {
    return Response.json({ ok: true, refreshed: 0, at: new Date().toISOString() });
  }

  const quotes = await getQuotes(Array.from(tickers));

  return Response.json({
    ok: true,
    requested: tickers.size,
    refreshed: quotes.size,
    at: new Date().toISOString(),
  });
}
