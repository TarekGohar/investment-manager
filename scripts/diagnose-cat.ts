import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  // All CAT transactions
  const txs = await prisma.transaction.findMany({
    where: { ticker: "CAT" },
    include: { brokerage: { select: { name: true, kind: true, currency: true } } },
    orderBy: { occurredAt: "asc" },
  });
  console.log(`CAT transactions: ${txs.length}\n`);
  for (const t of txs) {
    console.log(
      `  ${t.occurredAt.toISOString().slice(0, 10)}  ${t.kind.padEnd(12)}  qty=${t.quantity}  price=${t.price}  fees=${t.fees}  ${t.currency}  fx=${t.fxRateToCad ?? "—"}  · ${t.brokerage.name} (${t.brokerage.kind})`,
    );
    if (t.note) console.log(`    note: ${t.note}`);
  }

  // Latest quote for CAT
  const q = await prisma.quote.findUnique({ where: { ticker: "CAT" } });
  console.log(`\nCAT cached quote: ${q ? `${q.price} ${q.source ?? ""} (asOf ${q.asOf.toISOString()})` : "none"}`);

  await prisma.$disconnect();
})();
