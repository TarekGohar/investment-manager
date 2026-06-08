import "server-only";
import OpenAI, { AzureOpenAI } from "openai";
import type {
  AiProvider,
  ChatMessage,
  StreamChatParams,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "../types";

const DEFAULT_TOOL_ROUNDS = 6;

/**
 * Streaming implementation that works against any OpenAI-API-compatible
 * client (`OpenAI` or `AzureOpenAI` from the `openai` SDK). The factories
 * below construct the client; the streaming logic is shared.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly client: OpenAI | AzureOpenAI) {}

  async *streamChat({
    model,
    system,
    messages,
    tools = [],
    maxToolRounds = DEFAULT_TOOL_ROUNDS,
    maxTokens,
    signal,
  }: StreamChatParams): AsyncGenerator<StreamEvent> {
    const oaiMessages = toOpenAiMessages(system, messages);
    const oaiTools = tools.length > 0 ? tools.map(toOpenAiTool) : undefined;

    let finalText = "";
    const finalToolCalls: ToolCall[] = [];
    let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

    for (let round = 0; round < maxToolRounds; round++) {
      if (signal?.aborted) return;

      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: oaiMessages,
          tools: oaiTools,
          stream: true,
          stream_options: { include_usage: true },
          // Temperature 0.6 strikes a balance: PM-grade calls still have
          // variety, but at the default 1.0 gpt-4o occasionally produces
          // garbage tokens (CJK chars mid-English-sentence) when the
          // context includes structured data + tool results. Capping the
          // completion length prevents runaway generation if it does
          // happen. `max_completion_tokens` is the OpenAI-blessed param
          // since the o1 era — gpt-5+ rejects the legacy `max_tokens`.
          temperature: 0.6,
          max_completion_tokens: maxTokens ?? 2000,
        },
        signal ? { signal } : undefined,
      );

      let roundText = "";
      const roundCalls: ToolCall[] = [];
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        if (chunk.usage) {
          lastUsage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          roundText += delta.content;
          finalText += delta.content;
          yield { type: "text", delta: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (idx == null) continue;
            if (!roundCalls[idx]) roundCalls[idx] = { id: "", name: "", arguments: "" };
            if (tc.id) roundCalls[idx].id = tc.id;
            if (tc.function?.name) roundCalls[idx].name = tc.function.name;
            if (tc.function?.arguments) roundCalls[idx].arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }

      if (finishReason !== "tool_calls" || roundCalls.length === 0) {
        yield {
          type: "done",
          finalText,
          finalToolCalls,
          usage: lastUsage,
          model,
          finishReason,
        };
        return;
      }

      oaiMessages.push({
        role: "assistant",
        content: roundText || null,
        tool_calls: roundCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of roundCalls) {
        yield {
          type: "tool_call",
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        };
        finalToolCalls.push(tc);

        const toolDef = tools.find((t) => t.name === tc.name);
        let result: string;
        let isError = false;
        if (!toolDef) {
          result = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
          isError = true;
        } else {
          try {
            const args = safeParse(tc.arguments);
            const value = await toolDef.execute(args);
            result = JSON.stringify(value, jsonReplacer);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Tool execution failed";
            result = JSON.stringify({ error: message });
            isError = true;
          }
        }

        yield {
          type: "tool_result",
          id: tc.id,
          name: tc.name,
          result,
          isError,
        };

        oaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    yield {
      type: "error",
      error: `Reached tool round limit (${maxToolRounds}).`,
    };
  }
}

// ─── Factories ────────────────────────────────────────────────────────

export function createOpenAiProvider(): OpenAiCompatibleProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set in env.");
  }
  return new OpenAiCompatibleProvider(new OpenAI({ apiKey }));
}

export function createAzureOpenAiProvider(): OpenAiCompatibleProvider {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!apiKey) throw new Error("AZURE_OPENAI_API_KEY is not set in env.");
  if (!endpoint) {
    throw new Error(
      'AZURE_OPENAI_ENDPOINT is not set in env (e.g. "https://your-resource.openai.azure.com").',
    );
  }

  // On Azure, the `model` parameter sent to chat.completions.create is the
  // deployment name. Passing `deployment` here makes it the default; if
  // AI_MODEL is set, it overrides per-request.
  const client = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion,
    deployment,
  });

  return new OpenAiCompatibleProvider(client);
}

// ─── Helpers ──────────────────────────────────────────────────────────

type OpenAiMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAiMessages(system: string, history: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
      continue;
    }
    if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        tool_calls:
          m.toolCalls && m.toolCalls.length > 0
            ? m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              }))
            : undefined,
      });
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.result,
      });
      continue;
    }
  }
  return out;
}

function toOpenAiTool(t: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  };
}

function safeParse(json: string): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}
