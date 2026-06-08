/**
 * One-shot backfill: for every Transaction where the ticker is USD-listed
 * (no .TO/.V/.NE/.CN suffix) and currency='CAD' and fxRateToCad is null,
 * fetch the historical USD→CAD rate from BoC and persist it.
 *
 * Reason: the RBC importer (and legacy manual entries) recorded USD-listed
 * positions as CAD-priced with no FX rate captured, so we can't reconstruct
 * USD-equivalent values (FX exposure, foreign-tax-credit accounting) later.
 * No other fields are touched — currency and price stay as-is, only the
 * fxRateToCad is filled in.
 *
 * Run: npx tsx scripts/backfill-fx-rates.ts [--dry-run]
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { getFxRateToCad } from "../lib/marketdata/fx";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const dryRun = process.argv.includes("--dry-run");

function isUsdListed(ticker: string): boolean {
  return !/\.(TO|V|NE|CN)$/.test(ticker.toUpperCase());
}

(async () => {
  const candidates = await prisma.transaction.findMany({
    where: {
      currency: "CAD",
      fxRateToCad: null,
      ticker: { not: null },
    },
    select: {
      id: true,
      ticker: true,
      occurredAt: true,
      kind: true,
      currency: true,
    },
    orderBy: [{ ticker: "asc" }, { occurredAt: "asc" }],
  });

  const usdListed = candidates.filter((t) => t.ticker && isUsdListed(t.ticker));
  console.log(`Candidates: ${candidates.length} CAD/no-fx; ${usdListed.length} on USD-listed tickers`);

  let updated = 0;
  let failed = 0;
  for (const t of usdListed) {
    const fx = await getFxRateToCad("USD", t.occurredAt);
    if (!fx) {
      console.warn(`  ${t.ticker} ${t.occurredAt.toISOString().slice(0, 10)} ${t.kind}: FX lookup failed`);
      failed++;
      continue;
    }
    if (dryRun) {
      console.log(`  ${t.ticker?.padEnd(8)} ${t.occurredAt.toISOString().slice(0, 10)} ${t.kind.padEnd(12)} → rate=${fx.rate.toFixed(4)} asOf=${fx.asOf.toISOString().slice(0, 10)} (dry)`);
    } else {
      await prisma.transaction.update({
        where: { id: t.id },
        data: { fxRateToCad: fx.rate },
      });
      console.log(`  ${t.ticker?.padEnd(8)} ${t.occurredAt.toISOString().slice(0, 10)} ${t.kind.padEnd(12)} → rate=${fx.rate.toFixed(4)} asOf=${fx.asOf.toISOString().slice(0, 10)}`);
    }
    updated++;
  }
  console.log(`\n${dryRun ? "Would update" : "Updated"}: ${updated}.  Failed: ${failed}.`);

  await prisma.$disconnect();
})();
