import "server-only";
import { HOUSE_STYLE } from "@/lib/ai/context";
import { getModel, getProvider } from "@/lib/ai";
import { buildTools } from "@/lib/ai/tools";
import type { ChatMessage, StreamEvent, ToolDefinition } from "@/lib/ai/types";
import { ALL_SPECIALISTS } from "./types";
import type { EscalationRequest, Memo, SpecialistName } from "./types";
import type { SpecialistMemoStore } from "./persistence";

/**
 * CIO conversational prompt. Default mode — the user is talking to the CIO,
 * not to a committee. Most questions are answered alone from app data and
 * prior memos. Escalation requires user confirmation.
 */
export const CIO_CONVERSATIONAL_PROMPT = `${HOUSE_STYLE}

You are this user's Chief Investment Officer. They hired you to be a level-headed PM, not a chat assistant. Most of your value is what you DON'T do: you don't trade noise, you don't recommend without evidence, you don't pretend to know more than you do.

# You answer directly. The user controls when the panel runs.

Default behavior: ANSWER THE QUESTION YOURSELF using your data tools. Real PM, not a router. ADD / TRIM / EXIT / new BUY / thesis intactness / tax / behavioral — all of these get a direct, reasoned, conviction-weighted answer from you when the user asks them in passing. You ARE qualified to answer them. The panel exists for the user's deliberate moments, not for every prompt that touches a decision.

When a relevant specialist memo exists, ground your answer in it. Call \`recall_specialist_memo\` to pull it, quote the specialist by name, cite the memo's specific findings, and apply your synthesis to the user's actual question.

# Escalation is explicit-only

You do NOT escalate based on whether a topic feels decision-grade. Topic alone NEVER triggers a panel — the user controls when to spend committee-grade tokens, and they will tell you in plain language.

Escalate ONLY when the user's message contains an explicit instruction to convene the panel or a specific specialist. Phrases that trigger:

- "speak to your specialists" / "speak to the panel" / "ask the panel"
- "deep dive" / "deep analysis" / "full review" / "full panel" — **in this app, these phrases ALWAYS mean "escalate to the specialist panel," never "do more research yourself." If you see them, you escalate. Period. Do not interpret them as a request for thorough CIO work.**
- "run a panel" / "convene the panel" / "consult the committee"
- "get the [specialist name]'s take" / "have the [specialist] check..." / "ask the [specialist] about..." — **naming a specialist by role title is itself a trigger**, even without "panel" or "deep dive" wording.
- Any clearly synonymous phrasing where the user is asking for committee-grade work rather than a chat reply.

For ANY question without one of these triggers — even an obviously decision-grade one ("should I add to AVGO?") — you answer directly. You do NOT offer to escalate, do not hint at it, do not ask "want me to convene the panel?" Give the user your best PM reply and stop.

# Specialist selection (once an explicit trigger fires)

Pick deliberately based on what the user said:

- User named a specific specialist by role (business analyst, valuation analyst, risk analyst, tax strategist, behavioral coach, macro/industry analyst, devil's advocate, capital allocator) → **MANDATORY: route to that specialist.** Do NOT collapse the request into a direct answer because the question seems answerable from your tools — the user explicitly bought a specialist memo, not a CIO chat reply. Route to that single specialist only, unless the question genuinely cannot be answered without others.
- User asked for the panel generally → pick by question shape:
  - "deep dive on adding X" → Business, Valuation, Risk, Tax, Capital Allocator (+ Behavioral if there's a drift question, + Devil's Advocate on a new name)
  - "deep dive on trimming X" → Business (thesis intact?), Risk, Tax, Behavioral
  - "panel on a thesis re-check for X" → Business, Macro, Behavioral, Devil's Advocate
  - "where should new contribution room go?" → Capital Allocator, Tax
  - "rebalance review" → Risk, Tax, Behavioral, Capital Allocator
- Default ceiling: do NOT pick all 8. If the question is narrow, pick narrowly.

# Epistemic discipline

Same evidence rule as your specialists: if you don't have data to answer, say so. Don't infer from priors. Don't fill gaps with vibes. Don't cite specific numbers from training data. Where a recent memo answers part of the question and other parts are missing, name which is grounded and which is not.

# Tone

The user is sharp. Lead with the answer. Skip "let me clarify" preamble. Skip "consult a professional" closers. Skip "as your CIO I think..." — just say what you think.

Conviction language: "I'd hold." "I wouldn't add here." "Wait for the print on Sept 3." Avoid hedges like "consider whether" or "you may want to."`;

/**
 * CIO synthesis prompt. Runs AFTER the panel returns. Input is the user's
 * topic plus the formatted memos. Output is the synthesis reply (markdown).
 */
export const CIO_SYNTHESIS_PROMPT = `${HOUSE_STYLE}

You are this user's CIO. The investment-committee panel has returned. Below are the specialists' memos, each produced in isolation.

Your job: produce ONE recommendation, integrating their work. You do NO original analysis. Specialists have access to the data; your job is synthesis.

# Discipline

1. Weight memos by RELEVANCE to this specific decision, not by length or assertiveness. A short "insufficient evidence" memo beats a long unsourced one.
2. Run the gap-aggregation pass FIRST. Read every [GAP] across all memos. If critical gaps exist, your output is a NON-DECISION: "Cannot decide yet — here's what's needed." That is a valid and often correct output.
3. Surface disagreement EXPLICITLY. "Business sees a durable moat; Devil's Advocate names a credible erosion mechanism. Here's how I weigh them." Never smooth dissent into consensus that doesn't exist.
4. Confidence inheritance: your synthesis cannot be more confident than the strongest evidence underneath it. If every specialist returned medium or low, you cannot deliver a high-confidence call.
5. Never cite a number that isn't in a memo. Quote specialists by name when you do.

# Output structure (markdown)

**The call.** One sentence written as plain English: Buy / Add / Trim / Exit / Hold / Wait for [specific event] / More data needed. No hedging. Never echo enum-style tokens like \`NEED-MORE-DATA\`, \`WAIT-FOR-X\`, \`INSUFFICIENT_EVIDENCE\` back to the user — render them as natural phrases.

**Why.** 2-4 sentences citing specialists by name and their concrete findings.

**Where the specialists disagree.** Name it; do not smooth over.

**What would flip this call.** Specific, observable falsifiers — aggregate from the memos' whatWouldFlipMe entries.

**Critical gaps.** What evidence would meaningfully strengthen this call — aggregate from the memos' dataGaps entries, prioritized.

# Action contract

If — and only if — the call is decision-grade (ADD / TRIM / EXIT / HARVEST_LOSS / DEPLOY_ELSEWHERE / REBALANCE / HOLD_THROUGH_DRAWDOWN) and you have evidence to support it, call \`propose_decision\` to write the recommendation into the user's Decisions inbox. Three fields carry value: WHAT (action + ticker), WHY (one coherent \`rationale\` paragraph that names the relevant specialists by name, absorbs the falsifier as a clause, and names the review trigger as a clause — do NOT split these into separate sections), and DEGREE (numbers only in \`sizingDetails\`: \`targetWeightPct\`, \`currentWeightPct\`, \`expectedSharesDelta\`, \`expectedDollarDelta\`). If the call is WAIT-FOR-X or NEED-MORE-DATA, do NOT call propose_decision — write the reply and stop.`;

/**
 * Tools available to the CIO in conversational mode. Pulls the full app
 * toolset and adds two CIO-only tools: recall_specialist_memo and
 * request_panel.
 */
export function buildCioConversationalTools(args: {
  userId: string;
  conversationId?: string;
  store: SpecialistMemoStore;
  /**
   * Called when the CIO emits a request_panel tool call. The orchestrator
   * typically uses this to surface a "Run deep analysis?" confirm prompt in
   * the chat UI.
   */
  onEscalationRequested: (req: EscalationRequest) => Promise<void>;
}): ToolDefinition[] {
  const baseTools = buildTools(args.userId, args.conversationId);

  const recallMemo: ToolDefinition = {
    name: "recall_specialist_memo",
    description:
      "Pull the most recent specialist memos for a ticker. Use BEFORE giving a grounded answer on a held or watched name — the panel's prior work may already cover the question and save the user from re-running a deep analysis. Returns one memo per specialist, filtered to ones newer than `maxAgeDays` (default 120). Returns an empty list when nothing is on file.",
    parameters: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        specialists: {
          type: "array",
          items: { type: "string", enum: ALL_SPECIALISTS },
          description: "Restrict to these specialists. Omit for all.",
        },
        maxAgeDays: {
          type: "integer",
          description: "Default 120. Memos older than this are excluded.",
          minimum: 1,
          maximum: 730,
        },
      },
      required: ["ticker"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
      if (!ticker) return { error: "Missing ticker." };
      const specialists = getProp(input, "specialists") as SpecialistName[] | undefined;
      const maxAgeDays = (getProp(input, "maxAgeDays") as number | undefined) ?? 120;
      const memos = await args.store.findRecentByTicker({
        userId: args.userId,
        ticker,
        specialists,
        maxAgeDays,
      });
      return {
        ticker,
        count: memos.length,
        memos: memos.map(memoSummary),
      };
    },
  };

  const requestPanel: ToolDefinition = {
    name: "request_panel",
    description:
      "Request the investment-committee panel for a decision-grade question. The USER confirms before the panel actually runs — calling this tool does NOT itself convene anyone, it surfaces the request to the user. Only call when (a) the question is a real position-level decision, (b) a thesis re-validation is overdue, (c) the user explicitly asked for deep analysis, or (d) you genuinely lack evidence to answer alone. After calling this, continue your reply by telling the user in plain English what you want the panel to do and why.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The question to put to the panel, in the user's words or close to it.",
        },
        ticker: { type: ["string", "null"] },
        reason: {
          type: "string",
          description: "Why you're escalating instead of answering alone.",
        },
        recommendedSpecialists: {
          type: "array",
          items: { type: "string", enum: ALL_SPECIALISTS },
          description:
            "Specialists you want on this. Pick deliberately based on the question shape; don't always pick all eight.",
          minItems: 1,
        },
      },
      required: ["topic", "reason", "recommendedSpecialists"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const topic = String(getProp(input, "topic") ?? "");
      const ticker = getProp(input, "ticker") as string | null | undefined;
      const reason = String(getProp(input, "reason") ?? "");
      const recommendedSpecialists =
        (getProp(input, "recommendedSpecialists") as SpecialistName[] | undefined) ?? [];
      const request: EscalationRequest = {
        topic,
        ticker: ticker ?? null,
        reason,
        recommendedSpecialists,
      };
      await args.onEscalationRequested(request);
      return {
        ok: true,
        message:
          "Escalation requested. The user will see the request and confirm before the panel runs. Continue your reply by telling them in plain English what you want the panel to do and why.",
      };
    },
  };

  return [...baseTools, recallMemo, requestPanel];
}

function memoSummary(m: Memo) {
  return {
    specialist: m.specialist,
    asOf: m.asOf,
    confidence: m.confidence,
    conclusion: m.conclusion,
    findings: m.findings,
    steelmanOpposite: m.steelmanOpposite,
    whatWouldFlipMe: m.whatWouldFlipMe,
    dataGaps: m.dataGaps,
  };
}

function getProp(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * Stream CIO synthesis after the panel returns. Yields the same StreamEvent
 * union as the existing chat route, so callers can pipe straight into SSE.
 */
export async function* streamCioSynthesis(args: {
  userId: string;
  conversationId?: string;
  topic: string;
  ticker: string | null;
  memos: Memo[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const provider = getProvider();
  const model = getModel("chat");
  const tools = buildTools(args.userId, args.conversationId);
  const brief = formatMemosForCio({
    topic: args.topic,
    ticker: args.ticker,
    memos: args.memos,
  });
  const messages: ChatMessage[] = [{ role: "user", text: brief }];
  for await (const ev of provider.streamChat({
    model,
    system: CIO_SYNTHESIS_PROMPT,
    messages,
    tools,
    signal: args.signal,
  })) {
    yield ev;
  }
}

function humanizeConclusion(conclusion: string): string {
  // The memo schema requires specialists to emit the literal sentinel
  // "INSUFFICIENT_EVIDENCE" when they cannot make a call. Render it as
  // natural prose so the CIO synthesis doesn't echo the enum token verbatim.
  return conclusion.trim() === "INSUFFICIENT_EVIDENCE"
    ? "Insufficient evidence to make a call."
    : conclusion;
}

function formatMemosForCio(args: {
  topic: string;
  ticker: string | null;
  memos: Memo[];
}): string {
  const lines: string[] = [];
  lines.push(`Question to the panel: ${args.topic}`);
  if (args.ticker) lines.push(`Ticker: ${args.ticker}`);
  lines.push("");
  lines.push(`Panel returned ${args.memos.length} memo(s).`);
  for (const m of args.memos) {
    lines.push("");
    lines.push(
      `--- ${m.specialist} (confidence: ${m.confidence}, as of ${m.asOf.slice(0, 10)}) ---`,
    );
    lines.push(`Conclusion: ${humanizeConclusion(m.conclusion)}`);
    lines.push("Findings:");
    for (const f of m.findings) {
      const srcs = f.sources.length > 0 ? ` [sources: ${f.sources.join(", ")}]` : "";
      lines.push(`  [${f.tag}] (${f.dimension}) ${f.statement}${srcs}`);
    }
    if (m.steelmanOpposite) lines.push(`Steelman opposite: ${m.steelmanOpposite}`);
    if (m.whatWouldFlipMe.length > 0) {
      lines.push(`What would flip this view:`);
      for (const w of m.whatWouldFlipMe) lines.push(`  - ${w}`);
    }
    if (m.dataGaps.length > 0) {
      lines.push(`Data gaps:`);
      for (const g of m.dataGaps) lines.push(`  - ${g}`);
    }
  }
  return lines.join("\n");
}
