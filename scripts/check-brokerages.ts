import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });
(async () => {
  const bs = await prisma.brokerage.findMany({
    include: { _count: { select: { transactions: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${bs.length} brokerages:\n`);
  for (const b of bs) {
    console.log(`  ${b.name.padEnd(25)} kind=${String(b.kind).padEnd(20)} ccy=${b.currency}  txs=${b._count.transactions}  id=${b.id}`);
  }
  await prisma.$disconnect();
})();
