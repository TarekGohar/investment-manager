/**
 * Throwaway harness: run the Capital Allocator on AVGO.
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/run-capital-allocator.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { runCapitalAllocator } from "../lib/ai/panel/capital-allocator";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TICKER = "AVGO";

const BRIEF = `Produce the RANKED MENU for the next available marginal dollar, with ${TICKER} (Broadcom Inc.) as the proposed destination. Apply your methodology and tools — Singleton / Murphy / Pabrai / Greenblatt / Munger "compared to what?" lens.

Context: the user holds ${TICKER} at ~34% of NAV already (the largest single-name position). The question is: assuming a marginal dollar is available, where SHOULD it go? Five options to rank in priority order:
  1. Add to ${TICKER}
  2. Add to another existing holding (name it)
  3. Buy a watchlist name (name it, or mark [GAP])
  4. Hold as cash
  5. Pay down a contribution-room constraint (if relevant)

For each, justify with rough expected-return inputs (analyst target upside, conviction rating, cash yield) or mark [GAP] when missing. "Do nothing" is a first-class option — say so if that is the ranking.

You are NOT to evaluate business quality, intrinsic value, concentration / correlation, tax friction, behavioral patterns, or the bear case — those are other specialists' lanes. You produce the ranked menu. The CIO picks.`;

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
  const run = await runCapitalAllocator({
    userId: user.id,
    ticker: TICKER,
    brief: BRIEF,
  });
  const ms = Date.now() - start;

  console.log(`Finished in ${(ms / 1000).toFixed(1)}s`);
  console.log(`Tool calls observed: ${run.toolCalls.length}`);
  for (const tc of run.toolCalls) console.log(`  - ${tc.name}`);

  if (!run.memo) {
    console.error(`\nNo memo: ${run.error ?? "unknown error"}`);
    if (run.diagnostic) {
      console.error(`Finish reason: ${run.diagnostic.finishReason ?? "(none)"}`);
      if (run.diagnostic.finalText) {
        console.error(`\nTrailing model text:\n---\n${run.diagnostic.finalText}\n---`);
      }
    }
    await persistRaw({ memo: null, error: run.error, diagnostic: run.diagnostic, toolCalls: run.toolCalls, elapsedMs: ms });
    await prisma.$disconnect();
    process.exit(1);
  }

  const m = run.memo;
  console.log("\n=== MEMO ===");
  console.log(`Specialist: ${m.specialist}\nModel:      ${m.modelUsed}\nConfidence: ${m.confidence}\nAs of:      ${m.asOf}`);
  console.log(`\nCONCLUSION\n  ${m.conclusion}`);
  console.log(`\nFINDINGS (${m.findings.length})`);
  const order = ["FACT", "CALC", "INFER", "GAP"] as const;
  for (const tag of order) {
    const group = m.findings.filter((f) => f.tag === tag);
    if (group.length === 0) continue;
    console.log(`\n  [${tag}] (${group.length})`);
    for (const f of group) {
      console.log(`    • (${f.dimension}) ${f.statement}`);
      if (f.sources.length > 0) console.log(`        sources: ${f.sources.join(", ")}`);
    }
  }
  console.log(`\nSTEELMAN OPPOSITE\n  ${m.steelmanOpposite}`);
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
  const path = `tmp/capital-allocator-${TICKER}-${stamp}.json`;
  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log(`\nRaw output: ${path}`);
}
