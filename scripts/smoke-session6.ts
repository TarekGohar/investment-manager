/**
 * Session 6 smoke. Computes the three new summaries against the real user
 * DB and prints results so we can eyeball them for sanity.
 *
 * The compute functions live behind `server-only` so we re-implement the
 * essential logic here (replica). The full versions in lib/ stay the only
 * place the cards consume.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

async function fetchUsdToCad(): Promise<number> {
  const url = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5`;
  const res = await fetch(url);
  const j = (await res.json()) as { observations?: Array<{ FXUSDCAD?: { v: string } }> };
  for (let i = (j.observations?.length ?? 0) - 1; i >= 0; i--) {
    const v = j.observations![i].FXUSDCAD?.v;
    if (v) return Number(v);
  }
  return 1.38;
}

(async () => {
  const fx = await fetchUsdToCad();
  console.log(`USD→CAD: ${fx}\n`);

  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.log("No user.");
    process.exit(0);
  }
  console.log(`=== ${user.email} ===\n`);

  // Build current positions (qty, costBasis, currency) from txs
  const txs = await prisma.transaction.findMany({
    where: { userId: user.id },
    include: { brokerage: { select: { kind: true } } },
    orderBy: { occurredAt: "asc" },
  });

  type Pos = { ticker: string; currency: string; qty: number; costBasis: number };
  const positions = new Map<string, Pos>();
  for (const t of txs) {
    if (!t.ticker) continue;
    const p =
      positions.get(t.ticker) ??
      { ticker: t.ticker, currency: t.currency, qty: 0, costBasis: 0 };
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

  const quotes = await prisma.quote.findMany();
  const quoteByTicker = new Map(quotes.map((q) => [q.ticker, Number(q.price)]));
  function qcOf(t: string): "USD" | "CAD" {
    return /\.(TO|V|NE|CN)$/.test(t.toUpperCase()) ? "CAD" : "USD";
  }

  // Currency exposure
  console.log("— Currency exposure —");
  const byCcy = new Map<string, { assetsCad: number; native: number }>();
  for (const p of positions.values()) {
    if (p.qty <= 0) continue;
    const rawQuote = quoteByTicker.get(p.ticker);
    const qc = qcOf(p.ticker);
    const quoteToPos = qc === p.currency ? 1 : qc === "USD" && p.currency === "CAD" ? fx : 1;
    const mvNative = rawQuote != null ? rawQuote * quoteToPos * p.qty : p.costBasis;
    const fxToCad = p.currency === "CAD" ? 1 : fx;
    const mvCad = mvNative * fxToCad;
    const row = byCcy.get(p.currency) ?? { assetsCad: 0, native: 0 };
    row.assetsCad += mvCad;
    row.native += mvNative;
    byCcy.set(p.currency, row);
  }
  const totalCad = Array.from(byCcy.values()).reduce((s, r) => s + r.assetsCad, 0);
  for (const [ccy, r] of byCcy) {
    const pct = totalCad > 0 ? (r.assetsCad / totalCad) * 100 : 0;
    console.log(
      `  ${ccy}: ${r.assetsCad.toFixed(2)} CAD (${pct.toFixed(1)}%)${ccy !== "CAD" ? ` · native ${r.native.toFixed(2)}` : ""}`,
    );
  }
  const usdNative = byCcy.get("USD")?.native ?? 0;
  console.log(`  → 1¢ CAD/USD move = ${(usdNative * 0.01).toFixed(2)} CAD impact`);

  // Dividend forecast — sum last 12 months of DIVIDEND per ticker
  console.log("\n— Dividend forecast —");
  const cutoff = new Date(Date.now() - 365 * 86_400_000);
  const divs = txs.filter(
    (t) => t.kind === "DIVIDEND" && t.ticker && t.occurredAt >= cutoff,
  );
  const divsByTicker = new Map<string, { gross: number; fwt: number; ccy: string; count: number }>();
  for (const d of divs) {
    if (!d.ticker) continue;
    const r =
      divsByTicker.get(d.ticker) ?? { gross: 0, fwt: 0, ccy: d.currency, count: 0 };
    r.gross += d.price.toNumber();
    r.fwt += d.foreignTaxWithheld?.toNumber() ?? 0;
    r.count++;
    divsByTicker.set(d.ticker, r);
  }
  let totalGrossCad = 0;
  let totalFwtCad = 0;
  for (const [ticker, r] of divsByTicker) {
    const fxFactor = r.ccy === "CAD" ? 1 : fx;
    const grossCad = r.gross * fxFactor;
    const fwtCad = r.fwt * fxFactor;
    totalGrossCad += grossCad;
    totalFwtCad += fwtCad;
    console.log(
      `  ${ticker.padEnd(10)} ${r.ccy}  ${r.count} obs  gross ${grossCad.toFixed(2)} CAD${fwtCad > 0 ? `  FWT ${fwtCad.toFixed(2)}` : ""}`,
    );
  }
  console.log(`  Total forward 12m gross: ${totalGrossCad.toFixed(2)} CAD`);
  console.log(`  Total forward 12m FWT:   ${totalFwtCad.toFixed(2)} CAD`);
  console.log(`  Net after FWT:           ${(totalGrossCad - totalFwtCad).toFixed(2)} CAD`);

  // Attribution
  console.log("\n— Attribution (top 5 each side) —");
  const attribution: Array<{ ticker: string; ccy: string; unrealizedCad: number; returnPct: number; contribPct: number }> = [];
  let totalCostCadAll = 0;
  for (const p of positions.values()) {
    if (p.qty <= 0) continue;
    const fxToCad = p.currency === "CAD" ? 1 : fx;
    totalCostCadAll += p.costBasis * fxToCad;
  }
  for (const p of positions.values()) {
    if (p.qty <= 0) continue;
    const rawQuote = quoteByTicker.get(p.ticker);
    const qc = qcOf(p.ticker);
    const quoteToPos = qc === p.currency ? 1 : qc === "USD" && p.currency === "CAD" ? fx : 1;
    const mvNative = rawQuote != null ? rawQuote * quoteToPos * p.qty : null;
    if (mvNative == null) continue;
    const fxToCad = p.currency === "CAD" ? 1 : fx;
    const mvCad = mvNative * fxToCad;
    const costCad = p.costBasis * fxToCad;
    if (costCad <= 0) continue;
    const unrealizedCad = mvCad - costCad;
    attribution.push({
      ticker: p.ticker,
      ccy: p.currency,
      unrealizedCad,
      returnPct: (unrealizedCad / costCad) * 100,
      contribPct: totalCostCadAll > 0 ? (unrealizedCad / totalCostCadAll) * 100 : 0,
    });
  }
  const contributors = attribution.filter((a) => a.unrealizedCad > 0).sort((a, b) => b.unrealizedCad - a.unrealizedCad).slice(0, 5);
  const detractors = attribution.filter((a) => a.unrealizedCad < 0).sort((a, b) => a.unrealizedCad - b.unrealizedCad).slice(0, 5);
  console.log("  Top contributors:");
  for (const r of contributors) {
    console.log(
      `    ${r.ticker.padEnd(10)} ${r.ccy}  ${r.unrealizedCad >= 0 ? "+" : ""}${r.unrealizedCad.toFixed(2)} CAD  (${r.returnPct.toFixed(1)}% return, +${r.contribPct.toFixed(2)}pp)`,
    );
  }
  console.log("  Top detractors:");
  for (const r of detractors) {
    console.log(
      `    ${r.ticker.padEnd(10)} ${r.ccy}  ${r.unrealizedCad.toFixed(2)} CAD  (${r.returnPct.toFixed(1)}% return, ${r.contribPct.toFixed(2)}pp)`,
    );
  }

  await prisma.$disconnect();
  console.log("\nDone.");
})();
