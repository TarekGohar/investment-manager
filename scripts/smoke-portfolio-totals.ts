import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

async function fetchUsdToCad(): Promise<number> {
  const url = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5`;
  const res = await fetch(url);
  const j = (await res.json()) as { observations?: Array<{ d: string; FXUSDCAD?: { v: string } }> };
  for (let i = (j.observations?.length ?? 0) - 1; i >= 0; i--) {
    const v = j.observations![i].FXUSDCAD?.v;
    if (v) return Number(v);
  }
  return 1;
}

(async () => {
  const fx = await fetchUsdToCad();
  console.log(`USD→CAD: ${fx}\n`);

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    console.log(`=== ${u.email} ===`);
    const txs = await prisma.transaction.findMany({
      where: { userId: u.id, ticker: { not: null } },
      include: { brokerage: { select: { kind: true } } },
      orderBy: { occurredAt: "asc" },
    });
    const quotes = await prisma.quote.findMany();
    const quoteByTicker = new Map(quotes.map((q) => [q.ticker, Number(q.price)]));

    // Per-ticker rollup
    type Pos = { ticker: string; currency: string; qty: number; costBasis: number };
    const positions = new Map<string, Pos>();
    for (const t of txs) {
      if (!t.ticker) continue;
      const p =
        positions.get(t.ticker) ?? { ticker: t.ticker, currency: t.currency, qty: 0, costBasis: 0 };
      if (t.kind === "BUY" || t.kind === "TRANSFER_IN") {
        p.qty += t.quantity.toNumber();
        p.costBasis += t.quantity.toNumber() * t.price.toNumber() + t.fees.toNumber();
        if (p.currency === "CAD" && t.currency !== "CAD") p.currency = t.currency;
      } else if (t.kind === "SELL" || t.kind === "TRANSFER_OUT") {
        if (p.qty > 0) {
          const acb = p.costBasis / p.qty;
          const qtyOut = Math.min(t.quantity.toNumber(), p.qty);
          p.qty -= qtyOut;
          p.costBasis -= qtyOut * acb;
        }
      }
      positions.set(t.ticker, p);
    }

    function quoteCurrency(ticker: string): string {
      return /\.(TO|V|NE|CN)$/.test(ticker.toUpperCase()) ? "CAD" : "USD";
    }

    let totalMVCad = 0;
    let totalCostCad = 0;
    console.log(`Per position:`);
    for (const p of positions.values()) {
      if (p.qty <= 1e-9) continue;
      const rawQuote = quoteByTicker.get(p.ticker);
      const qc = quoteCurrency(p.ticker);
      const quoteToPosition =
        qc === p.currency ? 1 : qc === "USD" && p.currency === "CAD" ? fx : 1;
      const marketPriceNative = rawQuote != null ? rawQuote * quoteToPosition : null;
      const marketValueNative = marketPriceNative != null ? marketPriceNative * p.qty : null;
      const fxToCad = p.currency === "CAD" ? 1 : fx;
      const marketValueCad = marketValueNative != null ? marketValueNative * fxToCad : null;
      const costBasisCad = p.costBasis * fxToCad;
      console.log(
        `  ${p.ticker.padEnd(10)} ${p.currency}  qty=${String(p.qty).padStart(4)}  px=${marketPriceNative?.toFixed(2).padStart(10) ?? "—"} ${p.currency}  MV=${marketValueNative?.toFixed(2).padStart(10) ?? "—"} ${p.currency}  MV(CAD)=${marketValueCad?.toFixed(2).padStart(10) ?? "—"}  Cost(CAD)=${costBasisCad.toFixed(2).padStart(10)}`,
      );
      if (marketValueCad != null) totalMVCad += marketValueCad;
      totalCostCad += costBasisCad;
    }

    console.log(`\nPortfolio totals (CAD):`);
    console.log(`  Market value:  ${totalMVCad.toFixed(2)} CAD`);
    console.log(`  Cost basis:    ${totalCostCad.toFixed(2)} CAD`);
    console.log(`  Unrealized:    ${(totalMVCad - totalCostCad).toFixed(2)} CAD`);
    console.log(
      `  Unrealized %:  ${(((totalMVCad - totalCostCad) / totalCostCad) * 100).toFixed(2)}%`,
    );
  }
  await prisma.$disconnect();
})();
