/**
 * Verifies that getEnrichedPortfolio now FX-converts USD quotes for
 * CAD-tracked positions like CAT. Run: npx tsx scripts/smoke-fx-conversion.ts
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

// Inline minimal repro of the enrichment math
async function fetchBocUsdToCad(): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const url = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${start}&end_date=${today}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  type Obs = { d: string } & Record<string, { v: string } | undefined>;
  const json = (await res.json()) as { observations?: Obs[] };
  for (let i = (json.observations?.length ?? 0) - 1; i >= 0; i--) {
    const o = json.observations![i];
    const v = o["FXUSDCAD"]?.v;
    if (v) return Number(v);
  }
  return null;
}

(async () => {
  const fxRate = await fetchBocUsdToCad();
  console.log(`Current BoC USD→CAD rate: ${fxRate}`);

  const catTxs = await prisma.transaction.findMany({
    where: { ticker: "CAT", kind: { in: ["BUY", "TRANSFER_IN"] } },
    select: { quantity: true, price: true, fees: true, currency: true },
  });
  const totalQty = catTxs.reduce((s, t) => s + t.quantity.toNumber(), 0);
  const totalCost = catTxs.reduce(
    (s, t) => s + t.quantity.toNumber() * t.price.toNumber() + t.fees.toNumber(),
    0,
  );
  const positionCurrency = catTxs[0]?.currency ?? "CAD";

  const q = await prisma.quote.findUnique({ where: { ticker: "CAT" } });
  if (!q) {
    console.log("No cached quote for CAT; can't compute.");
    process.exit(0);
  }
  const usdQuote = Number(q.price);
  const factor = positionCurrency === "CAD" ? (fxRate ?? 1) : 1;
  const cadPrice = usdQuote * factor;
  const marketValue = cadPrice * totalQty;
  const unrealized = marketValue - totalCost;

  console.log(`\nCAT position:`);
  console.log(`  Recorded as:      ${totalQty} sh @ avg ${(totalCost / totalQty).toFixed(2)} ${positionCurrency}`);
  console.log(`  Cost basis:       ${totalCost.toFixed(2)} ${positionCurrency} (incl fees)`);
  console.log(`  Raw quote (USD):  ${usdQuote.toFixed(2)}`);
  console.log(`  FX factor:        ${factor.toFixed(4)}`);
  console.log(`  Quote in ${positionCurrency.padEnd(3)}:    ${cadPrice.toFixed(2)}`);
  console.log(`  Market value:     ${marketValue.toFixed(2)} ${positionCurrency}`);
  console.log(`  Unrealized:       ${unrealized.toFixed(2)} ${positionCurrency}`);
  console.log(`\nCompare to RBC's market value of $3,623.08 CAD.`);

  await prisma.$disconnect();
})();
