import "server-only";
import type { AiProvider, StreamChatParams, StreamEvent } from "../types";

/**
 * Anthropic adapter — placeholder.
 *
 * To activate Claude as a provider:
 *   1. `npm install @anthropic-ai/sdk`
 *   2. Set `ANTHROPIC_API_KEY` in `.env.local`
 *   3. Replace the body of this class with the Claude implementation (use
 *      `messages.stream` + content blocks; map `tool_use`/`tool_result` blocks
 *      to the same `StreamEvent` shape this file already defines).
 *   4. Set `AI_PROVIDER="anthropic"` and `AI_MODEL="claude-haiku-4-5-20251001"`
 *      in `.env.local`.
 *
 * The rest of the app doesn't change — every consumer talks to `AiProvider`,
 * not to the OpenAI SDK directly.
 */
export class AnthropicProvider implements AiProvider {
  // eslint-disable-next-line require-yield
  async *streamChat(_params: StreamChatParams): AsyncGenerator<StreamEvent> {
    throw new Error(
      "AnthropicProvider is not implemented yet. See lib/ai/providers/anthropic.ts for instructions.",
    );
  }
}
