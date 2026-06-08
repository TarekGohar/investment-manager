/**
 * Throwaway harness: run the Devil's Advocate on AVGO.
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/run-devils-advocate.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { runDevilsAdvocate } from "../lib/ai/panel/devils-advocate";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TICKER = "AVGO";

const BRIEF = `Argue the BEAR THESIS on ${TICKER} (Broadcom Inc.). You are structurally bearish by design — that is the job. Apply your methodology and tools.

Context: the user already holds this position. The other specialists (Business, Valuation, Risk, Tax, Behavioral, Macro) have presented their cases. Your role is to give the CIO the rigorous bear case to weigh against them. They are NOT asking for a balanced view (CIO synthesizes) — they are asking for the strongest, most evidence-grounded short thesis the data will support.

Each bear thesis must specify a MECHANISM (specific, observable), a PROBABILITY (low / moderate / high / near-certain), and a MAGNITUDE (specific drawdown range if the mechanism triggers). Vague doomsaying ("AI narrative could disappoint") fails the bar. If you cannot make a rigorous bear case from the evidence, write "INSUFFICIENT_EVIDENCE" — exaggeration is the failure mode this role is built to prevent.`;

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
  const run = await runDevilsAdvocate({
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
  console.log(`\nSTEELMAN OPPOSITE (strongest BULL rebuttal)\n  ${m.steelmanOpposite}`);
  if (m.whatWouldFlipMe.length > 0) {
    console.log(`\nWHAT WOULD NEUTRALIZE THIS BEAR CASE`);
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
  const path = `tmp/devils-advocate-${TICKER}-${stamp}.json`;
  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log(`\nRaw output: ${path}`);
}
