import "server-only";
import { prisma } from "@/lib/prisma";
import {
  fetchFilingText,
  listRecentFilings,
  type EdgarFilingListItem,
} from "@/lib/filings/edgar";
import { summarizeQuarterly } from "@/lib/ai/filings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily filings ingestion.
 *
 * For each held ticker, list recent SEC EDGAR filings (10-K / 10-Q / 8-K),
 * upsert into the Filing table, fetch primary-document text for the newest
 * 10-K or 10-Q if we haven't yet, and trigger an AI quarterly summary if
 * one doesn't already exist for that user.
 *
 * Cost discipline:
 *  - Only summarizes 10-K / 10-Q (the periodic filings worth deep reading).
 *  - Only summarizes once per (filing, user) — checks AIAnalysis first.
 *  - Skips if the filing body hasn't been successfully extracted.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sinceParam = new URL(req.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : daysAgo(60);

  // Held tickers per user, so we can route summaries to the right user.
  const txTickers = await prisma.transaction.findMany({
    where: { kind: { in: ["BUY", "TRANSFER_IN"] } },
    select: { userId: true, ticker: true },
    distinct: ["userId", "ticker"],
  });

  const tickersByUser = new Map<string, Set<string>>();
  const allTickers = new Set<string>();
  for (const t of txTickers) {
    if (!t.ticker) continue;
    if (!tickersByUser.has(t.userId)) tickersByUser.set(t.userId, new Set());
    tickersByUser.get(t.userId)!.add(t.ticker);
    allTickers.add(t.ticker);
  }

  let filingsIngested = 0;
  let summariesGenerated = 0;
  const errors: string[] = [];

  for (const ticker of allTickers) {
    let items: EdgarFilingListItem[] = [];
    try {
      items = await listRecentFilings(ticker, { since });
    } catch (err) {
      errors.push(`${ticker}: list ${(err as Error).message}`);
      continue;
    }

    for (const item of items) {
      try {
        const existing = await prisma.filing.findUnique({
          where: {
            source_externalId: { source: "EDGAR", externalId: item.accessionNumber },
          },
          select: { id: true, body: true },
        });

        let filingId: string;
        let body: string | null = existing?.body ?? null;

        if (!existing) {
          const created = await prisma.filing.create({
            data: {
              ticker,
              type: item.type,
              source: "EDGAR",
              externalId: item.accessionNumber,
              title: `${item.rawForm} · ${ticker}`,
              url: item.url,
              filedAt: item.filedAt,
            },
            select: { id: true },
          });
          filingId = created.id;
          filingsIngested++;
        } else {
          filingId = existing.id;
        }

        // Only deep-summarize the periodic filings.
        const summarizable = item.type === "TEN_K" || item.type === "TEN_Q";
        if (!summarizable) continue;

        // Lazy-load body the first time we want to summarize.
        if (!body) {
          body = await fetchFilingText(item.url);
          await prisma.filing.update({
            where: { id: filingId },
            data: { body },
          });
        }

        const filingFull = await prisma.filing.findUnique({
          where: { id: filingId },
        });
        if (!filingFull || !filingFull.body) continue;

        // For each user holding this ticker, generate a summary if missing.
        for (const [userId, userTickers] of tickersByUser) {
          if (!userTickers.has(ticker)) continue;
          const already = await prisma.aIAnalysis.findFirst({
            where: {
              userId,
              kind: "QUARTERLY_DEEP",
              ticker,
              metrics: { path: ["filingId"], equals: filingId },
            },
            select: { id: true },
          });
          if (already) continue;

          const prior = await prisma.filing.findFirst({
            where: {
              ticker,
              type: item.type,
              filedAt: { lt: item.filedAt },
              body: { not: null },
            },
            orderBy: { filedAt: "desc" },
          });

          const id = await summarizeQuarterly({
            userId,
            ticker,
            filing: { ...filingFull, body: filingFull.body },
            priorFiling: prior && prior.body ? { ...prior, body: prior.body } : null,
          });
          if (id) summariesGenerated++;
        }
      } catch (err) {
        errors.push(`${ticker}@${item.accessionNumber}: ${(err as Error).message}`);
      }
    }
  }

  return Response.json({
    ok: true,
    tickersScanned: allTickers.size,
    filingsIngested,
    summariesGenerated,
    errors,
    at: new Date().toISOString(),
  });
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}
