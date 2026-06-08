/**
 * Throwaway harness: run the Business Analyst on AVGO and pretty-print the
 * memo. Use this to judge whether the prompt + tool subset produce the kind
 * of memo you want, before scaling to the other seven specialists.
 *
 * Run: npx tsx scripts/run-business-analyst.ts
 *
 * The raw memo JSON is also written under tmp/ so you can diff runs against
 * each other as you iterate on the prompt.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });

import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { runBusinessAnalyst } from "../lib/ai/panel/business-analyst";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TICKER = "AVGO";

const BRIEF = `Assess the BUSINESS QUALITY of ${TICKER} (Broadcom Inc.) on the dimensions in your system prompt: moat (source + width + erosion signals), capital allocation, multi-year returns on capital, customer / supplier concentration, management, demand durability.

Context: the user already owns this position and is asking the panel whether the underlying business is still high-quality enough to keep compounding from here. They are NOT asking about price, sizing, tax, or whether to add — those are other specialists' jobs. Stay in lane.

You have no portfolio context, no prior conversation, and no other specialists' work. Use only the data your tools surface. Tag every claim. Admit [GAP] where data is missing — that is a valid and expected output.`;

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
  const run = await runBusinessAnalyst({
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
  const path = `tmp/business-analyst-${TICKER}-${stamp}.json`;
  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log(`\nRaw output: ${path}`);
}
