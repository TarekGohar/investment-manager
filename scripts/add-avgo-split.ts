/**
 * One-shot: reconcile AVGO's 10:1 forward split (2024-07-15).
 *
 * State today: the two 2024-06-01 TRANSFER_INs (RRSP 18sh @ 221.65, FHSA
 * 11sh @ 240.56) used post-split-normalized share counts and prices. No
 * SPLIT row exists.
 *
 * Fix: rewrite the historical TRANSFER_INs to PRE-split values (qty /= 10,
 * price *= 10), then insert a SPLIT row for each AVGO-holding brokerage
 * dated 2024-07-15 with ratio=10. End state — 29 shares, same total cost
 * basis, same ACB per share — is unchanged; the ledger now reflects the
 * actual chronology.
 *
 * Run: npx tsx scripts/add-avgo-split.ts [--dry-run]
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const SPLIT_DATE = new Date(Date.UTC(2024, 6, 15));
const RATIO = 10;
const dryRun = process.argv.includes("--dry-run");

(async () => {
  const transferIns = await prisma.transaction.findMany({
    where: {
      ticker: "AVGO",
      kind: "TRANSFER_IN",
      occurredAt: { lt: SPLIT_DATE },
    },
    select: { id: true, userId: true, brokerageId: true, occurredAt: true, quantity: true, price: true, currency: true, brokerage: { select: { name: true, kind: true } } },
  });
  if (transferIns.length === 0) {
    console.log("No pre-split AVGO TRANSFER_INs found — nothing to do.");
    return;
  }

  const existingSplit = await prisma.transaction.findFirst({
    where: { ticker: "AVGO", kind: "SPLIT", occurredAt: SPLIT_DATE },
  });
  if (existingSplit) {
    console.log("AVGO SPLIT on 2024-07-15 already exists — exiting.");
    return;
  }

  console.log("Pre-split TRANSFER_INs to rewrite:");
  for (const t of transferIns) {
    const oldQ = t.quantity.toNumber();
    const oldP = t.price.toNumber();
    const newQ = oldQ / RATIO;
    const newP = oldP * RATIO;
    console.log(
      `  ${t.brokerage.kind} ${t.occurredAt.toISOString().slice(0, 10)}  ${oldQ} @ ${oldP} ${t.currency}  →  ${newQ} @ ${newP} ${t.currency}`,
    );
  }

  const byBrokerage = new Map<string, { userId: string; brokerageId: string; currency: string }>();
  for (const t of transferIns) {
    byBrokerage.set(t.brokerageId, { userId: t.userId, brokerageId: t.brokerageId, currency: t.currency });
  }
  console.log(`\nSPLIT rows to insert: ${byBrokerage.size} (one per brokerage holding AVGO)`);
  for (const b of byBrokerage.values()) {
    console.log(`  brokerage=${b.brokerageId.slice(0, 8)}  ratio=${RATIO}  occurredAt=2024-07-15`);
  }

  if (dryRun) {
    console.log("\n(dry-run — no writes)");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const t of transferIns) {
      const oldQ = t.quantity.toNumber();
      const oldP = t.price.toNumber();
      await tx.transaction.update({
        where: { id: t.id },
        data: {
          quantity: new Prisma.Decimal(oldQ / RATIO),
          price: new Prisma.Decimal(oldP * RATIO),
        },
      });
    }
    for (const b of byBrokerage.values()) {
      await tx.transaction.create({
        data: {
          userId: b.userId,
          brokerageId: b.brokerageId,
          ticker: "AVGO",
          kind: "SPLIT",
          currency: b.currency,
          quantity: new Prisma.Decimal(0),
          price: new Prisma.Decimal(0),
          fees: new Prisma.Decimal(0),
          splitRatio: new Prisma.Decimal(RATIO),
          occurredAt: SPLIT_DATE,
          note: "AVGO 10-for-1 forward split (record 2024-07-12, ex 2024-07-15)",
        },
      });
    }
  });
  console.log("\nDone.");

  await prisma.$disconnect();
})();
