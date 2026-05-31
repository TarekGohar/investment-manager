import "server-only";
import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { backfillSnapshots } from "@/lib/portfolio/snapshots";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Manual snapshot backfill. POST with ?days=N (default 180) to populate
 * `PortfolioSnapshot` from historical candles. Idempotent — existing days
 * are skipped. Run this once after first installing the app so TWR / IRR /
 * drawdown have history to work against.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  const days = daysParam ? Number(daysParam) : 180;
  if (!Number.isFinite(days) || days < 1 || days > 1825) {
    return new NextResponse("days must be 1..1825", { status: 400 });
  }

  const from = new Date(Date.now() - days * 86_400_000);
  const result = await backfillSnapshots(session.user.id, { from });
  return NextResponse.json({ ok: true, written: result.written, from: from.toISOString() });
}
