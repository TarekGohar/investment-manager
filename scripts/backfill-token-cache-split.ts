/**
 * One-shot: zero out token counts on legacy Claude rows so the monthly spend
 * tile stops over-counting.
 *
 * Why: before commit 94a62fc the Anthropic provider summed `input_tokens`,
 * `cache_read_input_tokens`, and `cache_creation_input_tokens` into a single
 * `inputTokens` column and discarded the breakdown. The pricing layer then
 * priced the whole figure at the full input rate ($15/M for Opus), which
 * over-counts cache reads by 10× and cache writes by 1.25-2×.
 *
 * Cleanest fix is to drop the unrecoverable historical counts: the monthly
 * tile re-bases from zero and starts tracking accurately on the next request.
 * The body / model / metrics / timestamps on each row are preserved — only
 * the token columns are nulled.
 *
 * Scoped to:
 *   - models matching /claude/i   (OpenAI rows weren't affected — no cache)
 *   - rows where BOTH cachedTokens AND cacheCreationTokens are NULL
 *     (i.e. rows written by the OLD provider; new-provider rows already
 *     carry the proper split)
 *
 * Idempotent — running it twice is a no-op on the second pass.
 *
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/backfill-token-cache-split.ts
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

async function main() {
  const messageMatch = {
    model: { startsWith: "claude" },
    cachedTokens: null,
    cacheCreationTokens: null,
    OR: [{ inputTokens: { not: null } }, { outputTokens: { not: null } }],
  } as const;
  const analysisMatch = messageMatch;

  const [msgCount, anaCount] = await Promise.all([
    prisma.aIMessage.count({ where: messageMatch }),
    prisma.aIAnalysis.count({ where: analysisMatch }),
  ]);

  console.log(`Legacy AIMessage rows to reset:  ${msgCount}`);
  console.log(`Legacy AIAnalysis rows to reset: ${anaCount}`);
  if (msgCount === 0 && anaCount === 0) {
    console.log("\nNothing to do — all Claude rows already have the cache breakdown.");
    return;
  }

  // Sum the tokens we're about to nuke so the user knows the magnitude.
  const [msgAgg, anaAgg] = await Promise.all([
    prisma.aIMessage.aggregate({
      _sum: { inputTokens: true, outputTokens: true },
      where: messageMatch,
    }),
    prisma.aIAnalysis.aggregate({
      _sum: { inputTokens: true, outputTokens: true },
      where: analysisMatch,
    }),
  ]);
  const totalIn =
    (msgAgg._sum.inputTokens ?? 0) + (anaAgg._sum.inputTokens ?? 0);
  const totalOut =
    (msgAgg._sum.outputTokens ?? 0) + (anaAgg._sum.outputTokens ?? 0);
  console.log(
    `\nLegacy aggregate being cleared: ${totalIn.toLocaleString()} input + ${totalOut.toLocaleString()} output tokens.`,
  );

  const [updatedMsgs, updatedAnas] = await Promise.all([
    prisma.aIMessage.updateMany({
      where: messageMatch,
      data: { inputTokens: null, outputTokens: null },
    }),
    prisma.aIAnalysis.updateMany({
      where: analysisMatch,
      data: { inputTokens: null, outputTokens: null },
    }),
  ]);

  console.log(`\nCleared:`);
  console.log(`  AIMessage  ${updatedMsgs.count}`);
  console.log(`  AIAnalysis ${updatedAnas.count}`);
  console.log(
    `\nThe spend tile will re-base from zero. New Anthropic calls already write the cache breakdown so the tile stays accurate going forward.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
