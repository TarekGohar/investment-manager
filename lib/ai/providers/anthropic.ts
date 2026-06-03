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
 * the same way the OpenAI provider does, and marks two prefixes with
 * `cache_control` so the input portion of repeat requests reads from
 * Anthropic's prompt cache at 10% of the input rate:
 *
 *   1. System prompt (persona + house style) — 1h TTL. Anthropic's render
 *      order is tools → system → messages, so a marker on system caches
 *      tools + system together. Combined size for the PM chat path is
 *      ~6k tokens, comfortably above the 4096-token minimum on Opus models.
 *   2. Last message in the conversation — default 5min TTL. Caches the full
 *      history through the current turn so the *next* turn (and subsequent
 *      tool rounds within this turn) reads it as a cache hit. The 5min TTL
 *      matches typical chat cadence; longer wouldn't help since this marker
 *      gets replaced on every turn anyway.
 *
 * Smaller surfaces (daily / weekly review, news classifier, thesis check)
 * have personas well below the 4096-token minimum and will silently not
 * cache on Opus — the cache_control block is accepted but Anthropic writes
 * nothing. That's fine: those calls are short and their cost is dominated
 * by the dynamic payload (portfolio snapshot, filing text), not the persona.
 *
 * Anthropic allows up to 4 cache breakpoints per request. We use 2 and
 * strip any stale dynamic markers on each round to stay within the cap.
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
    // 1h TTL on the stable prefixes (system + tools). They almost never
    // change between requests, so paying the higher write cost (2× vs
    // 1.25× for the 5-min default) pays off after just a couple of cache
    // reads — and the cache survives 12× longer, covering sporadic
    // single-user sessions over a workday.
    const cachedSystem = [
      {
        type: "text" as const,
        text: system,
        cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
      },
    ];

    let finalText = "";
    const finalToolCalls: ToolCall[] = [];
    // Accumulate token usage across tool rounds — Anthropic reports per
    // round, but the caller needs a single per-turn total for billing.
    let aggInput = 0;
    let aggCached = 0;
    let aggCacheCreation = 0;
    let aggOutput = 0;

    for (let round = 0; round < maxToolRounds; round++) {
      if (signal?.aborted) return;

      markLastMessageForCache(anthroMessages);

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
              aggInput += u.input_tokens ?? 0;
              aggCached += u.cache_read_input_tokens ?? 0;
              aggCacheCreation += u.cache_creation_input_tokens ?? 0;
              aggOutput += u.output_tokens ?? 0;
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
          usage: {
            inputTokens: aggInput,
            outputTokens: aggOutput,
            cachedTokens: aggCached,
            cacheCreationTokens: aggCacheCreation,
          },
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

/**
 * Mark the last block of the last message with `cache_control: ephemeral`
 * so the entire prior conversation (system + tools + history through this
 * point) becomes a cached prefix. Anthropic reads the longest matching
 * cached prefix on each request, so the next turn — and subsequent rounds
 * of the same tool loop — bills the matched portion at $1.50/M.
 *
 * We strip prior dynamic markers first because the loop mutates
 * `anthroMessages` across rounds: round 1 marks user_N, then round 2
 * pushes assistant + tool_result, and we want the marker on the NEW last
 * message — not accumulating past the 4-breakpoint cap.
 */
function markLastMessageForCache(messages: AnthropicMessageParam[]): void {
  if (messages.length === 0) return;

  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block && typeof block === "object" && "cache_control" in block) {
          delete (block as { cache_control?: unknown }).cache_control;
        }
      }
    }
  }

  const last = messages[messages.length - 1];

  if (typeof last.content === "string") {
    last.content = [
      {
        type: "text",
        text: last.content,
        cache_control: { type: "ephemeral" },
      },
    ] as Anthropic.MessageParam["content"];
    return;
  }
  if (Array.isArray(last.content) && last.content.length > 0) {
    const lastBlock = last.content[last.content.length - 1] as {
      cache_control?: { type: "ephemeral" };
    };
    lastBlock.cache_control = { type: "ephemeral" };
  }
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  // No cache_control on tools — the system-prompt breakpoint already caches
  // tools + system together (Anthropic's render order is tools → system →
  // messages, so a marker on system covers everything above it). A separate
  // breakpoint on the last tool would cache the tools array alone, but our
  // tool definitions clock in around 3k tokens — below Opus's 4096-token
  // minimum cacheable prefix, so the breakpoint silently writes nothing.
  // Saves a breakpoint slot for the messages history without losing reads.
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Messages.Tool["input_schema"],
  }));
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
