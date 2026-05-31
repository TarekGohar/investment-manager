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
    }
  | { type: "error"; error: string };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
};

export type StreamChatParams = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Cap to prevent runaway tool loops. */
  maxToolRounds?: number;
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
