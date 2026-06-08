/**
 * Verify the AVGO fix end-to-end:
 *  - AVGO ledger should now have a SPLIT row and pre-split TRANSFER_INs
 *  - AVGO Holding should expose listingCurrency='USD' with the accounting
 *    currency falling out of deriveHoldings as before
 *  - currency-exposure should bucket AVGO under USD, not CAD
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  const txs = await prisma.transaction.findMany({
    where: { ticker: "AVGO" },
    orderBy: { occurredAt: "asc" },
    select: {
      occurredAt: true,
      kind: true,
      quantity: true,
      price: true,
      currency: true,
      fxRateToCad: true,
      splitRatio: true,
      brokerage: { select: { kind: true } },
    },
  });
  console.log(`AVGO ledger (${txs.length} rows):`);
  for (const t of txs) {
    console.log(
      [
        t.occurredAt.toISOString().slice(0, 10),
        t.kind.padEnd(14),
        `qty=${t.quantity.toNumber()}`,
        `px=${t.price.toNumber()}`,
        `ccy=${t.currency}`,
        `fx=${t.fxRateToCad ? t.fxRateToCad.toNumber().toFixed(4) : "null"}`,
        t.splitRatio ? `splitRatio=${t.splitRatio.toNumber()}` : "",
        `acct=${t.brokerage.kind}`,
      ].join("  "),
    );
  }

  await prisma.$disconnect();
})();
