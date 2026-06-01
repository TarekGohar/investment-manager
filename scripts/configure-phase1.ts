/**
 * One-off configuration script — Phase 1 (tax + performance profile).
 * Writes the user's QC marginal rates and benchmark/RFR into User.preferences.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TAX_PROFILE = {
  province: "QC",
  marginalOrdinaryRate: 0.4746,
  marginalCapGainsRate: 0.2373,
  marginalEligibleDividendRate: 0.3240,
  marginalNonEligibleDividendRate: 0.4179,
};

const PERFORMANCE_PROFILE = {
  benchmarkTicker: "VFV.TO",
  riskFreeRate: 0.035,
};

(async () => {
  const user = await prisma.user.findFirst({ select: { id: true, email: true, preferences: true } });
  if (!user) {
    console.error("No user found.");
    process.exit(1);
  }
  console.log(`User: ${user.email}`);

  const current = (user.preferences as Record<string, unknown> | null) ?? {};
  const before = {
    taxProfile: current.taxProfile ?? null,
    performanceProfile: current.performanceProfile ?? null,
  };

  const next = {
    ...current,
    taxProfile: TAX_PROFILE,
    performanceProfile: PERFORMANCE_PROFILE,
  };

  await prisma.user.update({
    where: { id: user.id },
    data: { preferences: next as unknown as Prisma.InputJsonValue },
  });

  console.log("\nBEFORE:");
  console.log(JSON.stringify(before, null, 2));
  console.log("\nAFTER:");
  console.log(JSON.stringify({ taxProfile: TAX_PROFILE, performanceProfile: PERFORMANCE_PROFILE }, null, 2));
  await prisma.$disconnect();
  console.log("\nSaved.");
})();
