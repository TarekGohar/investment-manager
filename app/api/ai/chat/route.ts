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

  const tools = buildTools(session.user.id);
  const provider = getProvider();
  const model = getModel();

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
      let usage: { inputTokens: number; outputTokens: number } | undefined;

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
              break;
            case "done":
              finalText = ev.finalText;
              finalToolCalls = ev.finalToolCalls;
              usage = ev.usage;
              break;
            case "error":
              send("error", { error: ev.error });
              break;
          }
        }

        // Persist whatever we got — even on abort, save partial output
        for (const tc of finalToolCalls) {
          const meta = toolMeta.get(tc.id);
          if (meta) {
            await saveToolMessage(conversation.id, tc.id, meta.name, meta.result);
          }
        }
        if (finalText || finalToolCalls.length > 0) {
          await saveAssistantMessage(conversation.id, {
            text: finalText,
            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
            model,
            inputTokens: usage?.inputTokens,
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
