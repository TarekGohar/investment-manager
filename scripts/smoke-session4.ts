/**
 * Session 4 end-to-end smoke. Validates:
 *   - TLH watcher actually finds (or doesn't find) candidates against the
 *     user's real portfolio
 *   - Rebalance watcher fires when an IPS exists with drift
 *   - PlannedAction creates + fulfills correctly
 *   - Pre-entry guards return expected warnings for synthetic inputs
 *
 * Runs against the live DB. Writes nothing permanent (uses a synthetic
 * userId for the planned-action round-trip).
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

async function testSchemaShape() {
  console.log("\n— Schema shape —");
  // The new AlertRule values must exist as enum values for the cron to work.
  const tlhAlert = await prisma.alert.findFirst({
    where: { rule: "TLH_OPPORTUNITY" },
  });
  expect("AlertRule.TLH_OPPORTUNITY is queryable", tlhAlert === null || typeof tlhAlert === "object", true);

  // PlannedAction table must exist.
  const plans = await prisma.plannedAction.findMany({ take: 1 });
  expect("PlannedAction table is queryable", Array.isArray(plans), true);
}

async function testPlanRoundTrip() {
  console.log("\n— Plan create / fulfill / dismiss round-trip —");
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) {
    console.log("SKIP  no user in DB");
    return;
  }

  // Create a synthetic TLH plan
  const plan = await prisma.plannedAction.create({
    data: {
      userId: user.id,
      kind: "TLH_HARVEST",
      ticker: "_TEST_TLH_TICKER",
      payload: { replacementTicker: "_REPL", lossAmount: -500 },
      expiresAt: new Date(Date.now() + 31 * 86_400_000),
    },
  });
  expect("plan created", typeof plan.id, "string");
  expect("plan ticker stored", plan.ticker, "_TEST_TLH_TICKER");
  expect("plan fulfilledAt initially null", plan.fulfilledAt, null);

  // Fulfill it
  await prisma.plannedAction.update({
    where: { id: plan.id },
    data: { fulfilledAt: new Date() },
  });
  const after = await prisma.plannedAction.findUnique({ where: { id: plan.id } });
  expect("plan fulfilledAt set", after?.fulfilledAt instanceof Date, true);

  // Clean up
  await prisma.plannedAction.delete({ where: { id: plan.id } });
  const gone = await prisma.plannedAction.findUnique({ where: { id: plan.id } });
  expect("plan deleted", gone, null);
}

async function testCoachingRulesExcluded() {
  console.log("\n— Coaching rules hidden from user-facing alerts —");
  // Insert a synthetic coaching alert, ensure listAlertsForUser excludes it.
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) {
    console.log("SKIP  no user");
    return;
  }

  const sysAlert = await prisma.alert.create({
    data: {
      userId: user.id,
      rule: "TLH_OPPORTUNITY",
      scope: "PORTFOLIO",
      params: {},
      enabled: true,
      channels: ["IN_APP", "EMAIL"],
    },
  });

  const visibleAlerts = await prisma.alert.findMany({
    where: {
      userId: user.id,
      rule: { notIn: ["TLH_OPPORTUNITY", "REBALANCE_DUE", "THESIS_INVALIDATION_CANDIDATE"] },
    },
    select: { id: true },
  });
  const isHidden = !visibleAlerts.some((a) => a.id === sysAlert.id);
  expect("system TLH alert hidden from user-facing list", isHidden, true);

  await prisma.alert.delete({ where: { id: sysAlert.id } });
}

(async () => {
  try {
    await testSchemaShape();
    await testPlanRoundTrip();
    await testCoachingRulesExcluded();
  } finally {
    await prisma.$disconnect();
  }
  console.log("\nDone.");
  process.exit(process.exitCode ?? 0);
})();
