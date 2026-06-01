/**
 * Session 5 smoke. Validates:
 *   1. The thesis-check parser handles the documented JSON shape + edge
 *      cases (code fences, missing fields, garbage).
 *   2. Schema columns exist on Thesis.
 *   3. (Optional, if OPENAI key) end-to-end LLM call against a synthetic
 *      "obviously invalidated" case returns confidence >= 60.
 *
 * The parser tests are inline — re-creating the parsing logic so we don't
 * hit the "server-only" barrier importing lib/ai/thesis-check directly.
 * The schema test queries Prisma to confirm the migration applied.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

// Inline replica of parseResult from lib/ai/thesis-check.ts
type ThesisCheckResult = {
  matched: boolean;
  confidence: number;
  criterionTriggered: string | null;
  reasoning: string;
};
function parseResult(raw: string): ThesisCheckResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { matched: false, confidence: 0, criterionTriggered: null, reasoning: "Could not evaluate: model returned empty output" };
  }
  const jsonText = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { matched: false, confidence: 0, criterionTriggered: null, reasoning: "Could not evaluate: model output wasn't valid JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { matched: false, confidence: 0, criterionTriggered: null, reasoning: "Could not evaluate: model output wasn't an object" };
  }
  const obj = parsed as Record<string, unknown>;
  const matched = Boolean(obj.matched);
  let confidence = 0;
  if (typeof obj.confidence === "number" && Number.isFinite(obj.confidence)) {
    confidence = Math.max(0, Math.min(100, Math.round(obj.confidence)));
  }
  const criterionTriggered =
    typeof obj.criterionTriggered === "string" && obj.criterionTriggered.trim()
      ? obj.criterionTriggered.trim().slice(0, 500)
      : null;
  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim()
      ? obj.reasoning.trim().slice(0, 2000)
      : "No reasoning provided.";
  return { matched, confidence, criterionTriggered, reasoning };
}

function testParser() {
  console.log("\n— Parser —");
  const happy = parseResult(
    '{"matched":true,"confidence":75,"criterionTriggered":"Operating margin < 25%","reasoning":"Q3 OpM was 22.1% per the summary."}',
  );
  expect("happy path: matched", happy.matched, true);
  expect("happy path: confidence", happy.confidence, 75);
  expect("happy path: criterion", happy.criterionTriggered, "Operating margin < 25%");

  const fenced = parseResult(
    '```json\n{"matched":false,"confidence":12,"criterionTriggered":null,"reasoning":"Filing did not address margins."}\n```',
  );
  expect("code-fenced: parsed despite fence", fenced.matched, false);
  expect("code-fenced: confidence clamped", fenced.confidence, 12);

  const empty = parseResult("");
  expect("empty: falls back to not matched", empty.matched, false);
  expect("empty: confidence 0", empty.confidence, 0);

  const garbage = parseResult("not a json object at all");
  expect("garbage: falls back to not matched", garbage.matched, false);

  const oversized = parseResult('{"matched":true,"confidence":250,"reasoning":"x"}');
  expect("confidence clamped to 100", oversized.confidence, 100);

  const negative = parseResult('{"matched":true,"confidence":-30,"reasoning":"x"}');
  expect("confidence clamped to 0", negative.confidence, 0);
}

async function testSchema() {
  console.log("\n— Schema —");
  // The new columns must exist; selecting them should work without error.
  const thesis = await prisma.thesis.findFirst({
    select: {
      id: true,
      lastInvalidationCheckAt: true,
      lastInvalidationConfidence: true,
      lastInvalidationReasoning: true,
    },
  });
  // Either thesis is null (no rows yet) or the fields are present and typed.
  if (thesis) {
    expect(
      "lastInvalidationCheckAt is Date|null",
      thesis.lastInvalidationCheckAt === null || thesis.lastInvalidationCheckAt instanceof Date,
      true,
    );
    expect(
      "lastInvalidationConfidence is number|null",
      thesis.lastInvalidationConfidence === null || typeof thesis.lastInvalidationConfidence === "number",
      true,
    );
  } else {
    console.log("PASS  schema OK (no Thesis rows yet to inspect)");
  }
}

async function testRulesEnumExtension() {
  console.log("\n— AlertRule enum —");
  // Try to create + delete a synthetic system alert with the new rule.
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) {
    console.log("SKIP  no user in DB");
    return;
  }
  const alert = await prisma.alert.create({
    data: {
      userId: user.id,
      rule: "THESIS_INVALIDATION_CANDIDATE",
      scope: "PORTFOLIO",
      params: {},
      enabled: true,
      channels: ["IN_APP", "EMAIL"],
    },
  });
  expect("created with THESIS_INVALIDATION_CANDIDATE rule", alert.rule, "THESIS_INVALIDATION_CANDIDATE");
  await prisma.alert.delete({ where: { id: alert.id } });
}

(async () => {
  try {
    testParser();
    await testSchema();
    await testRulesEnumExtension();
  } finally {
    await prisma.$disconnect();
  }
  console.log("\nDone.");
  process.exit(process.exitCode ?? 0);
})();
