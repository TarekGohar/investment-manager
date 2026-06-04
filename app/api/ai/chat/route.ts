import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getModel, getProvider } from "@/lib/ai";
import { PM_PERSONA } from "@/lib/ai/persona";
import { buildTools } from "@/lib/ai/tools";
import {
  getOrCreateConversation,
  listMessages,
  saveAssistantMessage,
  saveToolMessage,
  saveUserMessage,
  toChatHistory,
} from "@/lib/ai/queries";
import type { ChatMessage, ToolCall } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  message: string;
  conversationId?: string;
  /** "portfolio" or an uppercase ticker symbol */
  scope?: string;
};

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    return new Response("Bad Request", { status: 400 });
  }

  const scope = normalizeScope(body.scope);
  const conversation = body.conversationId
    ? { id: body.conversationId }
    : await getOrCreateConversation(session.user.id, scope);

  const userText = body.message.trim();

  await saveUserMessage(conversation.id, userText);

  const stored = await listMessages(conversation.id);
  const history = toChatHistory(stored);
  const messages: ChatMessage[] = [...history];

  const tools = buildTools(session.user.id, conversation.id);
  const provider = getProvider();
  const model = getModel("chat");

  const encoder = new TextEncoder();
  const aborter = new AbortController();
  // If the client disconnects, propagate the abort upstream to OpenAI
  if (req.signal) {
    req.signal.addEventListener("abort", () => aborter.abort(), { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      send("meta", { conversationId: conversation.id, model });

      let finalText = "";
      let finalToolCalls: ToolCall[] = [];
      const toolMeta = new Map<string, { name: string; result: string }>();
      let usage:
        | {
            inputTokens: number;
            outputTokens: number;
            cachedTokens?: number;
            cacheCreationTokens?: number;
          }
        | undefined;
      let finishReason: string | undefined;

      try {
        for await (const ev of provider.streamChat({
          model,
          system: PM_PERSONA,
          messages,
          tools,
          signal: aborter.signal,
        })) {
          switch (ev.type) {
            case "text":
              send("text", { delta: ev.delta });
              break;
            case "tool_call":
              send("tool_call", { id: ev.id, name: ev.name });
              toolMeta.set(ev.id, { name: ev.name, result: "" });
              break;
            case "tool_result":
              send("tool_result", { id: ev.id, name: ev.name, isError: ev.isError });
              toolMeta.set(ev.id, { name: ev.name, result: ev.result });
              // Surface successful propose_decision calls as a separate
              // event so the chat UI can render an inbox pill.
              if (ev.name === "propose_decision" && !ev.isError) {
                try {
                  const parsed = JSON.parse(ev.result) as {
                    ok?: boolean;
                    decisionId?: string;
                    url?: string;
                  };
                  if (parsed?.ok && parsed.decisionId) {
                    send("decision_raised", {
                      decisionId: parsed.decisionId,
                      url: parsed.url ?? `/alerts/${parsed.decisionId}`,
                    });
                  }
                } catch {
                  // Non-JSON result — skip silently.
                }
              }
              break;
            case "done":
              finalText = ev.finalText;
              finalToolCalls = ev.finalToolCalls;
              usage = ev.usage;
              finishReason = ev.finishReason;
              break;
            case "error":
              send("error", { error: ev.error });
              break;
          }
        }

        // If the model didn't finish cleanly, surface a one-line warning to
        // the user so a truncated / safety-filtered response doesn't look
        // like a bug or "the AI is bad". Common causes:
        //   "length"          → hit max_tokens cap (raise it)
        //   "content_filter"  → Azure RAI intervened (may also corrupt the tail)
        //   undefined         → stream was aborted before any finish chunk
        if (finishReason && finishReason !== "stop" && finishReason !== "tool_calls") {
          const reason =
            finishReason === "length"
              ? "Response was truncated at the max-tokens cap. Ask a more focused question or split it in two."
              : finishReason === "content_filter"
                ? "Azure's content filter cut the response short. The tail may also be garbled. Try rephrasing without potentially sensitive terms."
                : `Stream ended unexpectedly (${finishReason}).`;
          send("warning", { reason });
        }

        // Persist in OpenAI-replay-compatible order. For a turn that used
        // tools the structure must be:
        //   assistant { content: "", tool_calls: [...] }   ← the call
        //   tool      { tool_call_id, content: result }    ← the result
        //   assistant { content: finalText }               ← the reply
        // Saving tool results before the calling assistant message broke
        // the second turn with a 400 from the API: "messages with role
        // 'tool' must be a response to a preceeding message with
        // 'tool_calls'". The sequential awaits also guarantee monotonic
        // createdAt, so listMessages returns them in this exact order.
        if (finalToolCalls.length > 0) {
          await saveAssistantMessage(conversation.id, {
            text: "",
            toolCalls: finalToolCalls,
            model,
            inputTokens: usage?.inputTokens,
            cachedTokens: usage?.cachedTokens,
            cacheCreationTokens: usage?.cacheCreationTokens,
            // Attribute output tokens to the reply message below; this
            // intermediate "calls" message has no text output of its own.
          });
          for (const tc of finalToolCalls) {
            const meta = toolMeta.get(tc.id);
            if (meta) {
              await saveToolMessage(conversation.id, tc.id, meta.name, meta.result);
            }
          }
        }
        if (finalText) {
          const hasCalls = finalToolCalls.length > 0;
          await saveAssistantMessage(conversation.id, {
            text: finalText,
            toolCalls: undefined,
            model,
            // Input tokens are attributed to the calls message above
            // (where they were actually spent). Output goes here.
            inputTokens: hasCalls ? undefined : usage?.inputTokens,
            cachedTokens: hasCalls ? undefined : usage?.cachedTokens,
            cacheCreationTokens: hasCalls ? undefined : usage?.cacheCreationTokens,
            outputTokens: usage?.outputTokens,
          });
        }

        send("done", { usage, aborted: aborter.signal.aborted });
        controller.close();
      } catch (err) {
        if (aborter.signal.aborted) {
          // Client cancelled — close gracefully without surfacing an error
          send("done", { aborted: true });
        } else {
          const message = err instanceof Error ? err.message : "Stream failed";
          send("error", { error: message });
        }
        controller.close();
      }
    },
    cancel() {
      aborter.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function normalizeScope(raw: string | undefined): string {
  if (!raw) return "portfolio";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "portfolio") return "portfolio";
  // Tickers are uppercase A-Z plus dot (e.g. BRK.B); anything else falls back to portfolio
  const candidate = trimmed.toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(candidate)) return "portfolio";
  return candidate;
}
