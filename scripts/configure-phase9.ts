/**
 * Phase 9 — user-configurable alert rules.
 * Three rules total, all material-grade, all on IN_APP + EMAIL channels.
 *
 *   DRAWDOWN @ 25% (any holding): catches the "this position is down hard"
 *     case at the same threshold the panic-sell IPS guard uses.
 *   CONCENTRATION @ 30% (portfolio): single-name risk cap. AVGO is at
 *     ~32% today so this will fire on the first cron run.
 *   NEWS_MATERIAL (any holding): wakes up the user only when the AI news
 *     classifier flags a fresh headline as MATERIAL/CRITICAL.
 *
 * Idempotent: only creates a rule if no existing user rule of that
 * (rule, scope) pair already exists.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type AlertRule, type AlertScope } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

type RuleSpec = {
  rule: AlertRule;
  scope: AlertScope;
  params: Record<string, unknown>;
  label: string;
};

const RULES: RuleSpec[] = [
  {
    rule: "DRAWDOWN",
    scope: "HOLDING",
    params: { thresholdPct: 25 },
    label: "DRAWDOWN ≥ 25% from ACB (any holding)",
  },
  {
    rule: "CONCENTRATION",
    scope: "PORTFOLIO",
    params: { thresholdPct: 30 },
    label: "CONCENTRATION ≥ 30% (any single name)",
  },
  {
    rule: "NEWS_MATERIAL",
    scope: "HOLDING",
    params: {},
    label: "NEWS_MATERIAL — AI tags fresh headline MATERIAL/CRITICAL",
  },
];

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "tarekgohar@outlook.com" },
    select: { id: true },
  });

  for (const r of RULES) {
    const existing = await prisma.alert.findFirst({
      where: { userId: user.id, rule: r.rule, scope: r.scope, ticker: null },
    });
    if (existing) {
      // Update threshold/channels in case the user wanted to recalibrate.
      await prisma.alert.update({
        where: { id: existing.id },
        data: {
          params: r.params as unknown as object,
          channels: ["IN_APP", "EMAIL"] as unknown as object,
          enabled: true,
        },
      });
      console.log(`  ↻ updated: ${r.label}`);
    } else {
      await prisma.alert.create({
        data: {
          userId: user.id,
          rule: r.rule,
          scope: r.scope,
          ticker: null,
          params: r.params as unknown as object,
          channels: ["IN_APP", "EMAIL"] as unknown as object,
          enabled: true,
        },
      });
      console.log(`  + created: ${r.label}`);
    }
  }

  console.log("\nAll user-facing alerts now enabled. They'll fire on the next 21:10 UTC cron (or you can hit /decisions → Run now).");
  await prisma.$disconnect();
})();
