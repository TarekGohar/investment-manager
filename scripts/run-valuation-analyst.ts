/**
 * Throwaway harness: run the Valuation Analyst on AVGO. Mirrors the
 * Business Analyst harness so calibration is comparable.
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/run-valuation-analyst.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { runValuationAnalyst } from "../lib/ai/panel/valuation-analyst";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TICKER = "AVGO";

const BRIEF = `Assess PRICE vs VALUE for ${TICKER} (Broadcom Inc.) on the dimensions in your system prompt: intrinsic value range, current multiples vs history and peers, reverse-DCF, margin of safety, quality of earnings, and near-term catalysts.

Context: the user already owns this position and is asking whether the current price offers margin of safety, fair value, or is expensive — and what growth + margin path the market is implying at today's price. They are NOT asking about whether the business is good (Business Analyst's job), whether to buy/sell/size up (CIO synthesizes), or tax / portfolio fit. Stay in lane.

You have no portfolio context, no prior conversation, and no other specialists' work. Use only the data your tools surface. Tag every claim. Admit [GAP] where data is missing — multi-year multiple history is a known gap because the tools surface today's multiples, not historicals.`;

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
  const run = await runValuationAnalyst({
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
  const path = `tmp/valuation-analyst-${TICKER}-${stamp}.json`;
  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log(`\nRaw output: ${path}`);
}
