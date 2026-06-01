/**
 * Phase 6 — Investment Policy Statement
 * Target allocation, ticker categorization, drift threshold.
 *
 * Behavioral thresholds (panic-sell / FOMO / overtrading) come in Phase 7
 * and will be appended via upsert; we leave them null here.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TARGET_ALLOCATION: Record<string, number> = {
  "US Tech (large)": 50,
  "US Growth (high-beta)": 15,
  "US Broad / Index": 15,
  "Canadian Equity": 10,
  "International ex-NA": 5,
  "Cash": 5,
  "Other / Experimental": 0,
};

// Maps each currently-held ticker to a category. Tickers not in this map
// surface in the drift table as "uncategorized" and won't count toward
// any bucket — useful as a "did you forget to map this?" signal.
const TICKER_CATEGORIES: Record<string, string> = {
  // US Tech (large)
  AAPL: "US Tech (large)",
  MSFT: "US Tech (large)",
  AVGO: "US Tech (large)",
  AMZN: "US Tech (large)",
  // US Growth (high-beta)
  PLTR: "US Growth (high-beta)",
  NFLX: "US Growth (high-beta)",
  NET: "US Growth (high-beta)",
  DT: "US Growth (high-beta)",
  CRSP: "US Growth (high-beta)",
  // Canadian Equity
  RY: "Canadian Equity",
  // Other / Experimental — winding down or single-name industrial
  CAT: "Other / Experimental",
  BNKK: "Other / Experimental",
  "MVMD.CN": "Other / Experimental",
};

// Geography is a separate cut from allocation — used by some analytics
// (asset location, AI persona context). Keeping it simple here.
const TARGET_GEOGRAPHY: Record<string, number> = {
  US: 85,
  Canada: 10,
  International: 5,
};

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "tarekgohar@outlook.com" },
    select: { id: true },
  });

  await prisma.investmentPolicy.upsert({
    where: { userId: user.id },
    update: {
      targetAllocation: TARGET_ALLOCATION as unknown as Prisma.InputJsonValue,
      targetGeography: TARGET_GEOGRAPHY as unknown as Prisma.InputJsonValue,
      driftThresholdPct: 10,
      tickerCategories: TICKER_CATEGORIES as unknown as Prisma.InputJsonValue,
    },
    create: {
      userId: user.id,
      targetAllocation: TARGET_ALLOCATION as unknown as Prisma.InputJsonValue,
      targetGeography: TARGET_GEOGRAPHY as unknown as Prisma.InputJsonValue,
      driftThresholdPct: 10,
      tickerCategories: TICKER_CATEGORIES as unknown as Prisma.InputJsonValue,
    },
  });

  const saved = await prisma.investmentPolicy.findUnique({
    where: { userId: user.id },
  });

  console.log("Saved IPS:");
  console.log("  Drift threshold:", saved?.driftThresholdPct?.toString(), "pp");
  console.log("  Target allocation:");
  for (const [k, v] of Object.entries(TARGET_ALLOCATION)) {
    console.log(`    ${k.padEnd(28)} ${v}%`);
  }
  console.log("  Ticker categorization:");
  for (const [k, v] of Object.entries(TICKER_CATEGORIES)) {
    console.log(`    ${k.padEnd(10)} → ${v}`);
  }

  await prisma.$disconnect();
  console.log("\nDone.");
})();
