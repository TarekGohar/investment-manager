import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AiProvider,
  ChatMessage,
  StreamChatParams,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "../types";

const DEFAULT_TOOL_ROUNDS = 6;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Claude adapter. Streams with `messages.stream`, runs multi-round tool loops
 * the same way the OpenAI provider does, and marks the system message + tools
 * block with `cache_control: "ephemeral"` so the long PM persona and the
 * 20-tool definitions array get a 5-minute Anthropic cache hit. On chat turns
 * within a single conversation, that cuts the cached portion of input cost
 * by ~10×.
 *
 * The `_params.signal` is wired into the SDK request via `signal` so aborting
 * the SSE stream client-side actually cancels the upstream call.
 */
export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local or switch AI_PROVIDER.",
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async *streamChat({
    model,
    system,
    messages,
    tools = [],
    maxToolRounds = DEFAULT_TOOL_ROUNDS,
    signal,
  }: StreamChatParams): AsyncGenerator<StreamEvent> {
    const anthroMessages = toAnthropicMessages(messages);
    const anthroTools = tools.length > 0 ? toAnthropicTools(tools) : undefined;
    const cachedSystem = [
      {
        type: "text" as const,
        text: system,
        cache_control: { type: "ephemeral" as const },
      },
    ];

    let finalText = "";
    const finalToolCalls: ToolCall[] = [];
    let lastUsage:
      | { inputTokens: number; outputTokens: number; cachedTokens?: number }
      | undefined;

    for (let round = 0; round < maxToolRounds; round++) {
      if (signal?.aborted) return;

      const stream = this.client.messages.stream(
        {
          model,
          system: cachedSystem,
          messages: anthroMessages,
          tools: anthroTools,
          max_tokens: DEFAULT_MAX_TOKENS,
        },
        signal ? { signal } : undefined,
      );

      let roundText = "";
      // Tool-use blocks build up as the model streams. Key is the content
      // block index; value is the partial ToolCall + accumulating JSON args.
      const roundCalls = new Map<number, { id: string; name: string; arguments: string }>();
      let stopReason: string | undefined;

      try {
        for await (const event of stream) {
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "tool_use") {
              roundCalls.set(event.index, {
                id: block.id,
                name: block.name,
                arguments: "",
              });
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta;
            if (delta.type === "text_delta") {
              roundText += delta.text;
              finalText += delta.text;
              yield { type: "text", delta: delta.text };
            } else if (delta.type === "input_json_delta") {
              const tc = roundCalls.get(event.index);
              if (tc) tc.arguments += delta.partial_json;
            }
          } else if (event.type === "message_delta") {
            if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
            if (event.usage) {
              const u = event.usage as {
                input_tokens?: number;
                output_tokens?: number;
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              };
              lastUsage = {
                inputTokens:
                  (u.input_tokens ?? 0) +
                  (u.cache_read_input_tokens ?? 0) +
                  (u.cache_creation_input_tokens ?? 0),
                outputTokens: u.output_tokens ?? 0,
                cachedTokens: u.cache_read_input_tokens,
              };
            }
          }
        }
      } catch (err) {
        if (signal?.aborted) return;
        yield { type: "error", error: err instanceof Error ? err.message : String(err) };
        return;
      }

      const callsArray = Array.from(roundCalls.values());
      if (stopReason !== "tool_use" || callsArray.length === 0) {
        yield {
          type: "done",
          finalText,
          finalToolCalls,
          usage: lastUsage,
          model,
          finishReason: stopReason,
        };
        return;
      }

      // Echo the assistant message back into history with both the text it
      // wrote (if any) and the tool_use blocks it requested. Required by
      // Anthropic's API — the next message must be a user turn carrying the
      // tool_result blocks in the same order.
      const assistantContent: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      > = [];
      if (roundText) assistantContent.push({ type: "text", text: roundText });
      for (const tc of callsArray) {
        assistantContent.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: safeParse(tc.arguments),
        });
      }
      anthroMessages.push({ role: "assistant", content: assistantContent });

      const toolResultContent: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }> = [];

      for (const tc of callsArray) {
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

        toolResultContent.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: result,
          is_error: isError || undefined,
        });
      }

      anthroMessages.push({ role: "user", content: toolResultContent });
    }

    yield {
      type: "error",
      error: `Reached tool round limit (${maxToolRounds}).`,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

type AnthropicMessageParam = Anthropic.MessageParam;

function toAnthropicMessages(history: ChatMessage[]): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
      continue;
    }
    if (m.role === "assistant") {
      const content: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      > = [];
      if (m.text) content.push({ type: "text", text: m.text });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: safeParse(tc.arguments),
          });
        }
      }
      out.push({ role: "assistant", content: content.length > 0 ? content : m.text });
      continue;
    }
    if (m.role === "tool") {
      // Anthropic groups tool results into a user-role turn. If consecutive
      // tool messages arrive, fold them into the previous user-tool turn.
      const last = out[out.length - 1];
      const block = {
        type: "tool_result" as const,
        tool_use_id: m.toolCallId,
        content: m.result,
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  const out: Anthropic.Messages.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Messages.Tool["input_schema"],
  }));
  // Mark the final tool's definition with cache_control. Anthropic caches
  // every preceding block up to and including the marked one — so this
  // effectively caches the whole tools array.
  if (out.length > 0) {
    (out[out.length - 1] as unknown as { cache_control: { type: "ephemeral" } }).cache_control = {
      type: "ephemeral",
    };
  }
  return out;
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
