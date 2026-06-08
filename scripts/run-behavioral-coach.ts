/**
 * Throwaway harness: run the Behavioral / Conviction Coach on AVGO.
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/run-behavioral-coach.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { runBehavioralCoach } from "../lib/ai/panel/behavioral-coach";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TICKER = "AVGO";

const BRIEF = `Assess the USER's REASONING and BEHAVIOR around their ${TICKER} (Broadcom Inc.) position on the dimensions in your system prompt: is the stated thesis intact? has it drifted silently? is the conviction rating stale or trajectory-declining without a corresponding trim/exit? what's the decision history on this name? are any behavioral pattern thresholds tripping? do you see specific bias patterns (anchoring, recency, sunk-cost, story-following, herding, etc.) with evidence — and equally, where does the behavior look well-reasoned despite resembling a bias?

Context: the user holds AVGO at ~34% of NAV — significantly larger than any other position. The question is meta on the USER: are they reasoning soundly about this name, or is something in their process worth flagging? They are NOT asking about business quality (Business Analyst), price (Valuation Analyst), portfolio fit (Risk), or tax (Tax Strategist). Stay in lane on REASONING.

Pull the user's stated thesis, conviction trajectory, decision history, and behavioral pattern flags before drawing conclusions. For every potential bias finding, give both the bias interpretation AND the well-reasoned interpretation, and state which the evidence supports. Do not pathologize concentration that the user's framework already permits.`;

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    select: { id: true, email: true },
  });
  console.log(`User:   ${user.email}`);
  console.log(`Ticker: ${TICKER}`);
  console.log(`Brief:  ${BRIEF.length} chars`);
  console.log("");
  console.log("Running...");

  const start = Date.now();
  const run = await runBehavioralCoach({
    userId: user.id,
    ticker: TICKER,
    brief: BRIEF,
  });
  const ms = Date.now() - start;

  console.log(`Finished in ${(ms / 1000).toFixed(1)}s`);
  console.log(`Tool calls observed: ${run.toolCalls.length}`);
  for (const tc of run.toolCalls) {
    console.log(`  - ${tc.name}`);
  }

  if (!run.memo) {
    console.error(`\nNo memo: ${run.error ?? "unknown error"}`);
    if (run.diagnostic) {
      console.error(`Finish reason: ${run.diagnostic.finishReason ?? "(none)"}`);
      if (run.diagnostic.finalText) {
        console.error(`\nTrailing model text (${run.diagnostic.finalText.length} chars):`);
        console.error("---");
        console.error(run.diagnostic.finalText);
        console.error("---");
      }
    }
    await persistRaw({
      memo: null,
      error: run.error,
      diagnostic: run.diagnostic,
      toolCalls: run.toolCalls,
      elapsedMs: ms,
    });
    await prisma.$disconnect();
    process.exit(1);
  }

  const m = run.memo;
  console.log("\n=== MEMO ===");
  console.log(`Specialist: ${m.specialist}`);
  console.log(`Model:      ${m.modelUsed}`);
  console.log(`Confidence: ${m.confidence}`);
  console.log(`As of:      ${m.asOf}`);

  console.log(`\nCONCLUSION`);
  console.log(`  ${m.conclusion}`);

  console.log(`\nFINDINGS (${m.findings.length})`);
  const order = ["FACT", "CALC", "INFER", "GAP"] as const;
  for (const tag of order) {
    const group = m.findings.filter((f) => f.tag === tag);
    if (group.length === 0) continue;
    console.log(`\n  [${tag}] (${group.length})`);
    for (const f of group) {
      console.log(`    • (${f.dimension}) ${f.statement}`);
      if (f.sources.length > 0) {
        console.log(`        sources: ${f.sources.join(", ")}`);
      }
    }
  }

  console.log(`\nSTEELMAN OPPOSITE`);
  console.log(`  ${m.steelmanOpposite}`);

  if (m.whatWouldFlipMe.length > 0) {
    console.log(`\nWHAT WOULD FLIP ME`);
    for (const w of m.whatWouldFlipMe) console.log(`  • ${w}`);
  }

  if (m.dataGaps.length > 0) {
    console.log(`\nDATA GAPS (ordered)`);
    for (const g of m.dataGaps) console.log(`  • ${g}`);
  }

  await persistRaw({ memo: m, toolCalls: run.toolCalls, elapsedMs: ms });
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

async function persistRaw(payload: unknown) {
  await mkdir("tmp", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `tmp/behavioral-coach-${TICKER}-${stamp}.json`;
  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log(`\nRaw output: ${path}`);
}
