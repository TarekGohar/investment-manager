/**
 * End-to-end check: derive the enriched portfolio + currency exposure to
 * confirm the listingCurrency change correctly buckets USD-listed positions
 * regardless of accounting currency.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { getEnrichedPortfolio } from "../lib/portfolio/queries";
import { computeCurrencyExposure } from "../lib/portfolio/currency-exposure";
import { getCashBalances, summarizeCash } from "../lib/portfolio/cash";
import { getFxRateToCad } from "../lib/marketdata/fx";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
  const [portfolio, balances, fx] = await Promise.all([
    getEnrichedPortfolio(user.id),
    getCashBalances(user.id),
    getFxRateToCad("USD", new Date()),
  ]);
  const cash = summarizeCash(balances);
  const usdToCadRate = fx?.rate ?? null;

  console.log("\nPer-holding:");
  console.log("ticker        ccy   listing  qty       MV(native)   MV(CAD)      Cost(CAD)");
  for (const h of portfolio.holdings) {
    console.log(
      [
        h.ticker.padEnd(12),
        h.currency.padEnd(5),
        h.listingCurrency.padEnd(7),
        h.quantity.toFixed(2).padStart(9),
        (h.marketValue ?? 0).toFixed(2).padStart(11),
        (h.marketValueCad ?? 0).toFixed(2).padStart(11),
        h.costBasisCad.toFixed(2).padStart(11),
      ].join("  "),
    );
  }

  const exp = computeCurrencyExposure({ portfolio, cash, usdToCadRate });
  console.log("\nCurrency exposure (by listing currency):");
  for (const r of exp.rows) {
    console.log(
      `  ${r.currency}: valueCad=${r.valueCad.toFixed(2)}  valueNative=${r.valueNative.toFixed(2)}  pctOfNav=${r.pctOfNav.toFixed(2)}%  fxRate=${r.fxRate.toFixed(4)}`,
    );
  }
  console.log(`\n1¢ USD/CAD move impact: ${exp.oneCentUsdMoveImpactCad.toFixed(2)} CAD`);
  console.log(`Total NAV (CAD): ${exp.totalNavCad.toFixed(2)}`);

  await prisma.$disconnect();
})();
