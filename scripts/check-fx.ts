import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  const txs = await prisma.transaction.findMany({
    where: { currency: { not: "CAD" } },
    select: { ticker: true, kind: true, currency: true, price: true, quantity: true, occurredAt: true, fxRateToCad: true },
    orderBy: { occurredAt: "asc" },
  });
  console.log(`Non-CAD transactions: ${txs.length}`);
  let withFx = 0;
  for (const t of txs) {
    if (t.fxRateToCad) withFx++;
    console.log(`  ${t.occurredAt.toISOString().slice(0,10)}  ${t.kind.padEnd(11)}  ${(t.ticker ?? "—").padEnd(6)}  ${t.currency}  qty=${String(t.quantity).padStart(4)} px=${String(t.price).padStart(10)}  fxRate=${t.fxRateToCad ?? "NULL"}`);
  }
  console.log(`\nRows with fxRateToCad populated: ${withFx}/${txs.length}`);
  await prisma.$disconnect();
})();
