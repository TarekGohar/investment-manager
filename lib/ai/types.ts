/**
 * Provider-neutral AI types. Implementations live in `lib/ai/providers/*`.
 *
 * The interface below is intentionally minimal — just what's needed to stream
 * a chat with tool use. Adding a new provider means writing one file that
 * implements `AiProvider` and registering it in `lib/ai/index.ts`.
 */

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; result: string };

export type ToolCall = {
  id: string;
  name: string;
  /** Raw stringified JSON args, as they came back from the model. */
  arguments: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  parameters: Record<string, unknown>;
  /** Executes the tool. Receives parsed args; returns anything JSON-serializable. */
  execute: (input: unknown) => Promise<unknown>;
};

/**
 * Events emitted while streaming a chat. The route handler translates these
 * into SSE frames sent to the browser, and the client component re-renders
 * the live message as they arrive.
 */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "tool_result"; id: string; name: string; result: string; isError?: boolean }
  | {
      type: "done";
      finalText: string;
      finalToolCalls: ToolCall[];
      usage?: TokenUsage;
      model?: string;
      /**
       * OpenAI / Azure OpenAI `finish_reason` from the final chunk.
       * Values: "stop" (clean), "length" (hit max_tokens), "tool_calls"
       * (handed off to tools — provider keeps looping), "content_filter"
       * (Azure safety system intervened — output may be garbled or
       * truncated). Useful for surfacing to the user when output looks
       * broken.
       */
      finishReason?: string;
    }
  | { type: "error"; error: string };

export type TokenUsage = {
  /**
   * Uncached input tokens — the portion billed at full input rate. For
   * providers without prompt caching this is the entire input. For
   * Anthropic this excludes both `cachedTokens` (cache reads, billed at
   * ~10%) and `cacheCreationTokens` (cache writes, billed at 1.25–2×).
   */
  inputTokens: number;
  outputTokens: number;
  /** Cache-read input tokens (Anthropic). Billed at 10% of input rate. */
  cachedTokens?: number;
  /** Cache-write input tokens (Anthropic). Billed at 1.25× (5min TTL) or 2× (1h TTL) of input rate. */
  cacheCreationTokens?: number;
};

export type StreamChatParams = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Cap to prevent runaway tool loops. */
  maxToolRounds?: number;
  /**
   * Per-response max-output-tokens override. Default is provider-specific
   * (4096 on Anthropic). Bump when the model is expected to produce long
   * structured output (e.g. specialist memos with detailed [CALC] reasoning).
   */
  maxTokens?: number;
  /**
   * Aborts the upstream request when the consumer cancels the stream. The
   * provider should pass this to the SDK and bail out of the for-await loop.
   */
  signal?: AbortSignal;
};

export interface AiProvider {
  /** Streams a chat conversation, executing tools as the model requests them. */
  streamChat(params: StreamChatParams): AsyncGenerator<StreamEvent>;
}
