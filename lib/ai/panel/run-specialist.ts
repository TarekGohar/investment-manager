import "server-only";
import { getModel, getProvider, type ModelRole } from "@/lib/ai";
import { buildTools } from "@/lib/ai/tools";
import type { ChatMessage, ToolCall, ToolDefinition } from "@/lib/ai/types";
import type { Memo, MemoSubmission, SpecialistName, SpecialistRun } from "./types";

/**
 * Shared runner used by every specialist. Each specialist file exports its
 * own system prompt + allowed-tools whitelist and dispatches here. Keeps the
 * per-specialist files thin and ensures the stream-handling + memo-capture
 * logic stays in one place.
 */
export type SpecialistConfig = {
  specialist: SpecialistName;
  systemPrompt: string;
  allowedToolNames: ReadonlySet<string>;
  /** Defaults to "deep". Overridable for cheaper specialists if needed. */
  modelRole?: ModelRole;
};

const MEMO_SUBMISSION_SCHEMA = {
  type: "object",
  properties: {
    conclusion: {
      type: "string",
      description:
        'One or two sentences. Use the literal string "INSUFFICIENT_EVIDENCE" if the data does not support a call.',
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high", "insufficient"],
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string" },
          tag: { type: "string", enum: ["FACT", "CALC", "INFER", "GAP"] },
          statement: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
        },
        required: ["dimension", "tag", "statement", "sources"],
        additionalProperties: false,
      },
    },
    steelmanOpposite: {
      type: "string",
      description:
        "Strongest case against your conclusion. Mandatory even for insufficient-evidence calls.",
    },
    whatWouldFlipMe: {
      type: "array",
      items: { type: "string" },
      description: "Observable falsifiers.",
    },
    dataGaps: {
      type: "array",
      items: { type: "string" },
      description: "Ordered most-important first.",
    },
  },
  required: [
    "conclusion",
    "confidence",
    "findings",
    "steelmanOpposite",
    "whatWouldFlipMe",
    "dataGaps",
  ],
  additionalProperties: false,
} as const;

export async function runIsolatedSpecialist(
  config: SpecialistConfig,
  args: {
    userId: string;
    ticker: string;
    brief: string;
    signal?: AbortSignal;
  },
): Promise<SpecialistRun> {
  const allTools = buildTools(args.userId, undefined);
  const dataTools = allTools.filter((t) => config.allowedToolNames.has(t.name));

  const submitMemo: ToolDefinition = {
    name: "submit_memo",
    description:
      "Submit your structured memo. Must be your FINAL action. The CIO reads this verbatim — write it for the CIO, not as chat.",
    parameters: MEMO_SUBMISSION_SCHEMA as unknown as Record<string, unknown>,
    execute: async () => ({ received: true }),
  };

  const provider = getProvider();
  const model = getModel(config.modelRole ?? "deep");

  const messages: ChatMessage[] = [{ role: "user", text: args.brief }];

  let memoArgsRaw: string | null = null;
  const toolCalls: ToolCall[] = [];
  const toolsConsulted: string[] = [];
  let textBuffer = "";
  let finishReason: string | undefined;

  try {
    for await (const ev of provider.streamChat({
      model,
      system: config.systemPrompt,
      messages,
      tools: [...dataTools, submitMemo],
      // Specialist memos with [CALC] reasoning (reverse-DCF, intrinsic value
      // math) blow past the 4k default. 16k leaves room for the model's
      // pre-tool reasoning plus the final submit_memo payload.
      maxTokens: 16_384,
      signal: args.signal,
    })) {
      switch (ev.type) {
        case "tool_call":
          toolCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
          if (ev.name === "submit_memo") {
            memoArgsRaw = ev.arguments;
          } else {
            toolsConsulted.push(ev.name);
          }
          break;
        case "text":
          textBuffer += ev.delta;
          break;
        case "done":
          finishReason = ev.finishReason;
          if (ev.finalText) textBuffer = ev.finalText;
          break;
        case "error":
          return {
            memo: null,
            error: ev.error,
            toolCalls,
            diagnostic: { finalText: textBuffer, finishReason },
          };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Specialist stream failed.";
    return {
      memo: null,
      error: msg,
      toolCalls,
      diagnostic: { finalText: textBuffer, finishReason },
    };
  }

  if (!memoArgsRaw) {
    return {
      memo: null,
      error: "Specialist did not submit a memo.",
      toolCalls,
      diagnostic: { finalText: textBuffer, finishReason },
    };
  }

  let submission: MemoSubmission;
  try {
    submission = JSON.parse(memoArgsRaw) as MemoSubmission;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to parse memo.";
    return {
      memo: null,
      error: msg,
      toolCalls,
      diagnostic: { finalText: textBuffer, finishReason },
    };
  }

  const memo: Memo = {
    ...submission,
    specialist: config.specialist,
    ticker: args.ticker,
    asOf: new Date().toISOString(),
    brief: args.brief,
    modelUsed: model,
    toolsConsulted: dedupe(toolsConsulted),
  };

  return { memo, toolCalls };
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
