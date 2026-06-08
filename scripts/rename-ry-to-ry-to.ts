/**
 * One-shot: rename ticker "RY" → "RY.TO" on all matching rows.
 *
 * Why: RBC DI export reports Royal Bank as a naked "RY" symbol regardless of
 * which exchange the user actually holds it on. The user holds the TSX
 * listing (RY.TO, CAD), but the codebase resolves naked "RY" via
 * quoteCurrencyForTicker as USD (no .TO/.V/.NE/.CN suffix). That misroutes
 * quote lookups and FX-exposure bucketing.
 *
 * Run: npx tsx scripts/rename-ry-to-ry-to.ts [--dry-run]
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const dryRun = process.argv.includes("--dry-run");

(async () => {
  const txs = await prisma.transaction.findMany({
    where: { ticker: "RY" },
    select: { id: true, occurredAt: true, kind: true, currency: true },
    orderBy: { occurredAt: "asc" },
  });
  console.log(`Found ${txs.length} RY transactions`);

  const watchlist = await prisma.watchlistItem.findMany({
    where: { ticker: "RY" },
    select: { id: true, userId: true },
  });
  console.log(`Found ${watchlist.length} RY watchlist entries`);

  // Check there isn't already an RY.TO ticker (would conflict on watchlist unique constraint).
  const existingDotTo = await prisma.transaction.findFirst({ where: { ticker: "RY.TO" } });
  if (existingDotTo) {
    console.warn("⚠ RY.TO transactions already exist — proceeding with rename anyway.");
  }

  if (dryRun) {
    console.log("(dry-run) Would rename:");
    for (const t of txs) {
      console.log(`  tx ${t.occurredAt.toISOString().slice(0, 10)} ${t.kind}  (${t.currency})`);
    }
    return;
  }

  const result = await prisma.transaction.updateMany({
    where: { ticker: "RY" },
    data: { ticker: "RY.TO" },
  });
  console.log(`Renamed ${result.count} transactions`);

  // Watchlist has a unique(userId, ticker) constraint — handle one at a time
  // and let any duplicate fail loudly.
  for (const w of watchlist) {
    try {
      await prisma.watchlistItem.update({
        where: { id: w.id },
        data: { ticker: "RY.TO" },
      });
      console.log(`Renamed watchlist row ${w.id}`);
    } catch (err) {
      console.warn(`Watchlist row ${w.id} rename failed (likely RY.TO already on this user):`, err instanceof Error ? err.message : err);
    }
  }

  await prisma.$disconnect();
})();
