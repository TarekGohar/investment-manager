/**
 * Manually invoke evaluateUserAlerts for the single user.
 * Mimics what /api/cron/run-alerts does on its schedule.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { evaluateUserAlerts } from "../lib/signals/evaluate";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "tarekgohar@outlook.com" },
    select: { id: true, email: true },
  });
  console.log(`Running alerts for ${user.email}...`);

  const result = await evaluateUserAlerts(user.id);
  console.log(`\nEvaluated ${result.evaluated} user-configured alert(s)`);
  console.log(`Fired ${result.fired} new event(s)\n`);
  if (result.events.length > 0) {
    console.log("Fresh events:");
    for (const e of result.events) {
      console.log(`  · [${e.ticker ?? "—"}] ${e.message.slice(0, 200)}`);
    }
  } else {
    console.log("(no new events — could be cooldown / dedup, or genuinely nothing material)");
  }
  await prisma.$disconnect();
})();
