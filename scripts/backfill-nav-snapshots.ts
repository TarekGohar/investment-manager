/**
 * Backfill PortfolioSnapshot rows from historical price candles. Idempotent —
 * existing days are skipped. Run once whenever NAV snapshot history is thin
 * (e.g. after first install, or when TWR / beta / Sharpe come back null).
 *
 * Default span is 365 days. Pass --days=N to override.
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/backfill-nav-snapshots.ts [--days=365]
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { backfillSnapshots } from "../lib/portfolio/snapshots";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : 365;
  if (!Number.isFinite(days) || days < 1 || days > 1825) {
    console.error("--days must be between 1 and 1825");
    await prisma.$disconnect();
    process.exit(1);
  }

  const user = await prisma.user.findFirstOrThrow({
    select: { id: true, email: true },
  });
  console.log(`User: ${user.email}`);
  console.log(`Backfilling ${days} days...`);

  const before = await prisma.portfolioSnapshot.count({ where: { userId: user.id } });
  const start = Date.now();
  const from = new Date(Date.now() - days * 86_400_000);
  const result = await backfillSnapshots(user.id, { from });
  const after = await prisma.portfolioSnapshot.count({ where: { userId: user.id } });
  const ms = Date.now() - start;

  console.log(`\nFinished in ${(ms / 1000).toFixed(1)}s`);
  console.log(`Snapshots before: ${before}`);
  console.log(`Snapshots after:  ${after}`);
  console.log(`Newly written:    ${result.written}`);

  if (after > 0) {
    const first = await prisma.portfolioSnapshot.findFirst({
      where: { userId: user.id },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    const last = await prisma.portfolioSnapshot.findFirst({
      where: { userId: user.id },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    console.log(`Range: ${first?.date.toISOString().slice(0, 10)} → ${last?.date.toISOString().slice(0, 10)}`);
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
