/**
 * Router efficiency test. Runs the CIO conversationally against a battery
 * of test questions and captures the routing decision WITHOUT firing any
 * specialist. The `request_panel` tool's execute() captures the request
 * via `onEscalationRequested` — no actual panel runs.
 *
 * Use this to calibrate: does the CIO escalate too eagerly (wasting tokens)?
 * Does it escalate too rarely (under-serving real decisions)? Does it pick
 * the right specialists for the question shape?
 *
 * Run: NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" npx tsx scripts/router-test.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { getModel, getProvider } from "../lib/ai";
import {
  CIO_CONVERSATIONAL_PROMPT,
  buildCioConversationalTools,
} from "../lib/ai/panel/cio";
import { InMemoryMemoStore } from "../lib/ai/panel/persistence";
import type { EscalationRequest, SpecialistName } from "../lib/ai/panel/types";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

/**
 * Each test question carries an EXPECTATION used only for the post-run
 * summary (the model never sees expectations). "direct" means answer
 * without escalating; an array means escalate to (at least) these
 * specialists. Use [] for "may escalate, but checking discretion."
 */
type Expectation = "direct" | SpecialistName[] | "either";

const TESTS: Array<{ q: string; expected: Expectation; note?: string }> = [
  // ── Pass 1: NO trigger phrase. Even decision-grade questions should answer DIRECT. ──
  {
    q: "What's my current AVGO position size?",
    expected: "direct",
    note: "Pure lookup.",
  },
  {
    q: "Should I add more to my AVGO position at this price?",
    expected: "direct",
    note: "Decision-grade but NO trigger — CIO answers directly with conviction.",
  },
  {
    q: "I'm thinking about adding NVDA to the book. What should I think about?",
    expected: "direct",
    note: "New-name BUY question but NO trigger — CIO answers directly.",
  },
  {
    q: "Should I trim my AVGO position to get it back closer to my IPS cap?",
    expected: "direct",
    note: "TRIM question but NO trigger — CIO answers directly.",
  },
  {
    q: "Are there any tax-loss harvest opportunities in my non-registered accounts right now?",
    expected: "direct",
    note: "Tax question but NO trigger.",
  },
  {
    q: "Is my AVGO thesis still intact after the recent earnings print?",
    expected: "direct",
    note: "Thesis-intactness question but NO trigger.",
  },

  // ── Pass 2: WITH explicit triggers. Should escalate to the right specialists. ──
  {
    q: "Speak to your specialists — should I add more to AVGO at this price?",
    expected: ["BUSINESS_ANALYST", "VALUATION_ANALYST", "RISK_PORTFOLIO", "TAX_STRATEGIST", "CAPITAL_ALLOCATOR"],
    note: "Generic 'speak to the panel' on an ADD question.",
  },
  {
    q: "Run a deep dive on whether I should buy NVDA.",
    expected: ["BUSINESS_ANALYST", "VALUATION_ANALYST", "RISK_PORTFOLIO", "TAX_STRATEGIST", "CAPITAL_ALLOCATOR", "DEVILS_ADVOCATE"],
    note: "'Deep dive' trigger on a new-name BUY.",
  },
  {
    q: "Convene the panel on trimming AVGO back to my IPS cap.",
    expected: ["BUSINESS_ANALYST", "RISK_PORTFOLIO", "TAX_STRATEGIST", "BEHAVIORAL_COACH"],
    note: "'Convene the panel' on a TRIM.",
  },
  {
    q: "Have the behavioral coach check whether I'm being biased on the AVGO dip-buy.",
    expected: ["BEHAVIORAL_COACH"],
    note: "Named single specialist — should route narrowly.",
  },
  {
    q: "Get the tax strategist's take on whether I should harvest any losses this year.",
    expected: ["TAX_STRATEGIST"],
    note: "Named single specialist.",
  },
  {
    q: "Ask the panel where my $10k of new TFSA room should go.",
    expected: ["CAPITAL_ALLOCATOR", "TAX_STRATEGIST"],
    note: "Panel trigger on a capital-deployment question. Should be narrow.",
  },
  {
    q: "Run a full review of whether my AVGO thesis is still intact.",
    expected: ["BUSINESS_ANALYST", "MACRO_INDUSTRY", "BEHAVIORAL_COACH", "DEVILS_ADVOCATE"],
    note: "'Full review' trigger on thesis re-validation.",
  },
];

type Result = {
  q: string;
  expected: Expectation;
  escalated: boolean;
  specialists: SpecialistName[];
  reason: string;
  topic: string;
  toolsCalled: string[];
  responseSnippet: string;
  timeMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    select: { id: true, email: true },
  });
  console.log(`User: ${user.email}\nTests: ${TESTS.length}\n`);

  const results: Result[] = [];

  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i];
    console.log(`[${i + 1}/${TESTS.length}] "${t.q}"`);

    let escalation: EscalationRequest | null = null;
    const store = new InMemoryMemoStore();
    const tools = buildCioConversationalTools({
      userId: user.id,
      conversationId: undefined,
      store,
      onEscalationRequested: async (req) => {
        // Capture only — do NOT run the panel.
        escalation = req;
      },
    });

    const provider = getProvider();
    const model = getModel("router");
    const toolsCalled: string[] = [];
    let finalText = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    const start = Date.now();
    try {
      for await (const ev of provider.streamChat({
        model,
        system: CIO_CONVERSATIONAL_PROMPT,
        messages: [{ role: "user", text: t.q }],
        tools,
        maxTokens: 4096,
      })) {
        if (ev.type === "tool_call") toolsCalled.push(ev.name);
        if (ev.type === "text") finalText += ev.delta;
        if (ev.type === "done") {
          if (ev.finalText) finalText = ev.finalText;
          inputTokens = ev.usage?.inputTokens;
          outputTokens = ev.usage?.outputTokens;
        }
      }
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }

    const timeMs = Date.now() - start;
    const esc = escalation as EscalationRequest | null;

    results.push({
      q: t.q,
      expected: t.expected,
      escalated: esc !== null,
      specialists: esc?.recommendedSpecialists ?? [],
      reason: esc?.reason ?? "",
      topic: esc?.topic ?? "",
      toolsCalled,
      responseSnippet: finalText.slice(0, 220),
      timeMs,
      inputTokens,
      outputTokens,
    });

    const verdict = esc ? `ESCALATE → ${esc.recommendedSpecialists.join(", ")}` : "DIRECT";
    console.log(
      `  ${verdict}  |  ${toolsCalled.length} tools  |  ${(timeMs / 1000).toFixed(1)}s`,
    );
    if (esc) console.log(`  reason: ${esc.reason.slice(0, 140)}`);
  }

  // Summary table
  console.log("\n\n=== SUMMARY ===\n");
  const fmt = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

  console.log(fmt("Question", 60), "Verdict     Tools  Time   Match");
  console.log("-".repeat(120));

  let totalInTok = 0;
  let totalOutTok = 0;
  let correct = 0;

  for (const r of results) {
    totalInTok += r.inputTokens ?? 0;
    totalOutTok += r.outputTokens ?? 0;

    const verdict = r.escalated ? "ESCALATE" : "DIRECT  ";
    let match = "✓";
    if (r.expected === "direct") {
      match = r.escalated ? "✗ over-escalated" : "✓";
      if (!r.escalated) correct++;
    } else if (r.expected === "either") {
      match = "·";
      correct++;
    } else {
      // Array of expected specialists
      const expSet = new Set(r.expected);
      const gotSet = new Set(r.specialists);
      const missing = [...expSet].filter((s) => !gotSet.has(s));
      const extras = [...gotSet].filter((s) => !expSet.has(s));
      if (!r.escalated) {
        match = "✗ did not escalate";
      } else if (missing.length === 0 && extras.length === 0) {
        match = "✓ exact";
        correct++;
      } else if (missing.length === 0) {
        match = `~ extras: ${extras.join(",")}`;
        correct++;
      } else {
        match = `✗ missing: ${missing.join(",")}`;
      }
    }

    console.log(
      fmt(r.q, 60),
      verdict,
      String(r.toolsCalled.length).padStart(5),
      (r.timeMs / 1000).toFixed(1).padStart(5) + "s",
      " ",
      match,
    );
    if (r.escalated && r.specialists.length > 0) {
      console.log("                                                              ", "                  ", `→ ${r.specialists.join(", ")}`);
    }
  }

  console.log("\n=== TOTALS ===");
  console.log(`Tests:           ${results.length}`);
  console.log(`Model:           ${getModel("router")}`);
  console.log(`Routing match:   ${correct}/${results.length}`);
  console.log(
    `Direct answers:  ${results.filter((r) => !r.escalated).length}  (saves ~$12-15 each in unused panel runs)`,
  );
  console.log(`Escalations:     ${results.filter((r) => r.escalated).length}`);
  console.log(`Total tokens in: ${totalInTok.toLocaleString()}`);
  console.log(`Total tokens out:${totalOutTok.toLocaleString()}`);
  // Pricing by model family (per million tokens). Caller-reported; verify
  // with provider before invoicing anyone. Opus $15/$75, Sonnet $3/$15,
  // Haiku $0.8/$4, GPT-4o $2.5/$10.
  const model = getModel("router");
  // Published rates (Anthropic + OpenAI, per million tokens, full input
  // price — does not account for cache reads at the lower cached-input rate).
  const rates = model.includes("opus")
    ? { in: 15, out: 75 }
    : model.includes("sonnet")
      ? { in: 3, out: 15 }
      : model.includes("haiku")
        ? { in: 0.8, out: 4 }
        : model.includes("gpt-5") // gpt-5 / gpt-5.4: $2.50/M in (cached $0.25), $15/M out
          ? { in: 2.5, out: 15 }
          : model.includes("gpt-4o-mini")
            ? { in: 0.15, out: 0.6 }
            : model.includes("gpt-4o")
              ? { in: 2.5, out: 10 }
              : { in: 15, out: 75 };
  const cost = (totalInTok / 1_000_000) * rates.in + (totalOutTok / 1_000_000) * rates.out;
  console.log(`Approx CIO cost: $${cost.toFixed(3)}  (rates: $${rates.in}/M in, $${rates.out}/M out)`);
  console.log(`If every q fired full Opus panel: ~$${(15 * results.length).toFixed(0)}`);

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
