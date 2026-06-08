/**
 * Throwaway harness: run the Macro & Industry Analyst on AVGO.
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/run-macro-industry.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { runMacroIndustry } from "../lib/ai/panel/macro-industry";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TICKER = "AVGO";

const BRIEF = `Assess INDUSTRY and CYCLE CONTEXT for ${TICKER} (Broadcom Inc.) on the dimensions in your system prompt: industry structure (custom silicon / networking ASICs / infrastructure software), structural-vs-cyclical mix of the demand driving the business, cycle position with observable evidence (capex cycle for hyperscaler customers, regulatory environment), base rates where you have evidence, secular tailwinds / headwinds.

Context: the user holds this position. The question is whether the INDUSTRY context supports continued compounding from here, or whether structural / cyclical factors point to elevated risk that's invisible in security-level analysis. They are NOT asking about business quality (Business Analyst), price (Valuation Analyst), portfolio fit (Risk), tax, or behavioral reasoning. Stay in lane on INDUSTRY context.

You may NOT emit directional macro forecasts. No "AI cycle is peaking" or "rates headed lower" calls. Frame structural-vs-cyclical, cite observable evidence, admit [GAP] when you don't have industry-wide data. Management commentary in the transcript is your strongest macro signal — use it.`;

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
  const run = await runMacroIndustry({
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
  const path = `tmp/macro-industry-${TICKER}-${stamp}.json`;
  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log(`\nRaw output: ${path}`);
}
