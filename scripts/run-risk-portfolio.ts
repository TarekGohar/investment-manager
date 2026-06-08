/**
 * Throwaway harness: run the Risk & Portfolio Construction Analyst on AVGO.
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/run-risk-portfolio.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { runRiskPortfolio } from "../lib/ai/panel/risk-portfolio";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

const TICKER = "AVGO";

const BRIEF = `Assess the RISK FIT of ${TICKER} (Broadcom Inc.) inside the user's current portfolio on the dimensions in your system prompt: concentration vs single-name and theme caps from the IPS, correlation with existing holdings, current sizing in NAV terms, drawdown sensitivity, FX exposure (USD position, CAD-reporting), drift vs target allocation.

Context: the user already owns this position. They are asking whether the position is appropriately sized given the rest of the book. They are NOT asking about the business quality (Business Analyst), the price/value (Valuation Analyst), or whether to add/trim/exit (CIO synthesizes). Stay in lane on FIT.

Pull the actual portfolio, the IPS, and the correlation matrix before drawing conclusions. Cite cap values beside actual weights. If any IPS cap is null, mark a [GAP] and refuse to opine on that dimension — never invent a default.`;

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
  const run = await runRiskPortfolio({
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
  const path = `tmp/risk-portfolio-${TICKER}-${stamp}.json`;
  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log(`\nRaw output: ${path}`);
}
