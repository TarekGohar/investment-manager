import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });
const SHS_RE = /ON\s+([0-9,]+(?:\.[0-9]+)?)\s+SHS/i;

(async () => {
  // For each (brokerage, ticker) with DIVIDENDs but no BUY/TRANSFER_IN,
  // dump every dividend's note + amount so we can infer shares.
  const ORPHANS = [
    { ticker: "RY", brokerage: "FHSA" },
    { ticker: "AVGO", brokerage: "RRSP" },
    { ticker: "AVGO", brokerage: "FHSA" },
    { ticker: "MSFT", brokerage: "RRSP" },
    { ticker: "MSFT", brokerage: "FHSA" },
    { ticker: "MSFT", brokerage: "TFSA" },
    { ticker: "AAPL", brokerage: "FHSA" },
    { ticker: "CRM", brokerage: "FHSA" },
  ];
  for (const o of ORPHANS) {
    const bk = await prisma.brokerage.findFirst({ where: { name: o.brokerage } });
    if (!bk) continue;
    const divs = await prisma.transaction.findMany({
      where: { ticker: o.ticker, brokerageId: bk.id, kind: "DIVIDEND" },
      orderBy: { occurredAt: "desc" },
      take: 3,
      select: { occurredAt: true, price: true, currency: true, note: true },
    });
    if (divs.length === 0) continue;
    const shareCounts = divs
      .map((d) => d.note?.match(SHS_RE)?.[1])
      .filter((s): s is string => Boolean(s))
      .map((s) => Number(s.replace(/,/g, "")));
    console.log(`\n${o.ticker} in ${o.brokerage}:`);
    for (const d of divs) {
      const sh = d.note?.match(SHS_RE)?.[1] ?? "?";
      console.log(`  ${d.occurredAt.toISOString().slice(0,10)}  $${d.price.toNumber().toFixed(2)} ${d.currency}  on ${sh} sh`);
    }
    if (shareCounts.length > 0) {
      const latest = shareCounts[0];
      console.log(`  → most-recent share count: ${latest}`);
    }
  }
  await prisma.$disconnect();
})();
