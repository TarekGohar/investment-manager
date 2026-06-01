/**
 * Diagnoses why imported transactions aren't producing holdings.
 * Run: npx tsx scripts/diagnose-holdings.ts
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    console.log(`\n=== ${u.email} ===`);
    const brokerages = await prisma.brokerage.findMany({
      where: { userId: u.id },
      select: { id: true, name: true, kind: true },
    });
    const txs = await prisma.transaction.findMany({
      where: { userId: u.id },
      select: { brokerageId: true, kind: true, ticker: true, quantity: true, price: true, occurredAt: true },
    });
    console.log(`Brokerages: ${brokerages.length}`);
    brokerages.forEach((b) => console.log(`  ${b.kind}: ${b.name} (${b.id})`));
    console.log(`Transactions: ${txs.length}`);

    // Per-ticker rollup of net position
    const byTicker = new Map<string, { buys: number; sells: number; divs: number; deposits: number; brokerages: Set<string> }>();
    for (const t of txs) {
      if (t.kind === "DEPOSIT" || t.kind === "WITHDRAWAL") {
        const key = "(cash)";
        const cur = byTicker.get(key) ?? { buys: 0, sells: 0, divs: 0, deposits: 0, brokerages: new Set() };
        cur.deposits += t.price.toNumber();
        cur.brokerages.add(t.brokerageId);
        byTicker.set(key, cur);
        continue;
      }
      const key = t.ticker ?? "(no ticker)";
      const cur = byTicker.get(key) ?? { buys: 0, sells: 0, divs: 0, deposits: 0, brokerages: new Set() };
      if (t.kind === "BUY" || t.kind === "TRANSFER_IN") cur.buys += t.quantity.toNumber();
      else if (t.kind === "SELL" || t.kind === "TRANSFER_OUT") cur.sells += t.quantity.toNumber();
      else if (t.kind === "DIVIDEND") cur.divs += 1;
      cur.brokerages.add(t.brokerageId);
      byTicker.set(key, cur);
    }
    console.log("\nPer-ticker activity:");
    const ord = Array.from(byTicker.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [tk, v] of ord) {
      const net = v.buys - v.sells;
      const status =
        tk === "(cash)"
          ? "—"
          : v.buys === 0 && v.divs > 0
            ? "❌ MISSING BUYS (only dividends — opening position is older than CSV export)"
            : net <= 0 && v.sells > 0
              ? "(fully closed)"
              : "✓ position";
      console.log(`  ${tk.padEnd(12)} buys=${v.buys.toString().padStart(4)} sells=${v.sells.toString().padStart(4)} divs=${v.divs.toString().padStart(3)} net=${net.toString().padStart(5)}  ${status}`);
    }
  }
  await prisma.$disconnect();
})();
