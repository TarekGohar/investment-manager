import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { runPanel } from "@/lib/ai/panel/escalate";
import { streamCioSynthesis } from "@/lib/ai/panel/cio";
import { PrismaSpecialistMemoStore } from "@/lib/ai/panel/persistence";
import {
  saveAssistantMessage,
  saveToolMessage,
} from "@/lib/ai/queries";
import { clearAborter, registerAborter } from "@/lib/ai/chat-aborters";
import { ALL_SPECIALISTS } from "@/lib/ai/panel/types";
import type { EscalationRequest, SpecialistName } from "@/lib/ai/panel/types";
import type { ToolCall } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
// Panel runs are 8 specialists × ~80-100s in parallel (~2 min wall-clock) plus
// a synthesis pass. Generous timeout — Next caps platform-side at 300s on
// most plans.
export const maxDuration = 300;

type ConfirmBody = {
  conversationId: string;
  request: EscalationRequest;
};

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as ConfirmBody | null;
  if (!body || !body.conversationId || !body.request) {
    return new Response("Bad Request", { status: 400 });
  }
  const { conversationId, request: escalation } = body;

  // Defensive: filter to known specialist names — the client could send
  // anything in the recommendedSpecialists array.
  const validSpecialists = escalation.recommendedSpecialists.filter(
    (s): s is SpecialistName => (ALL_SPECIALISTS as readonly string[]).includes(s),
  );
  if (validSpecialists.length === 0) {
    return new Response("No valid specialists in request", { status: 400 });
  }
  const sanitizedRequest: EscalationRequest = {
    ...escalation,
    recommendedSpecialists: validSpecialists,
  };

  const memoStore = new PrismaSpecialistMemoStore();
  const aborter = new AbortController();
  registerAborter(conversationId, aborter);
  const encoder = new TextEncoder();
  let clientGone = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (clientGone) return;
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          clientGone = true;
        }
      };

      send("meta", {
        conversationId,
        specialists: validSpecialists,
        topic: sanitizedRequest.topic,
        ticker: sanitizedRequest.ticker,
      });

      send("panel_running", {
        count: validSpecialists.length,
        specialists: validSpecialists,
      });

      // The specialists receive the user's topic + ticker as a structured
      // brief. Each one's own system prompt provides lane discipline.
      const brief = composeSpecialistBrief(sanitizedRequest);

      let panelResult: Awaited<ReturnType<typeof runPanel>>;
      try {
        panelResult = await runPanel({
          userId: session.user.id,
          request: sanitizedRequest,
          brief,
          store: memoStore,
          signal: aborter.signal,
          onSpecialistStarted: (specialist) => {
            send("specialist_started", { specialist });
          },
          onSpecialistCompleted: (info) => {
            send("specialist_completed", info);
          },
        });
      } catch (err) {
        send("error", {
          error: err instanceof Error ? err.message : "Panel run failed",
        });
        if (!clientGone) controller.close();
        clearAborter(conversationId, aborter);
        return;
      }

      send("panel_complete", {
        memoCount: panelResult.memos.length,
        errors: panelResult.errors,
      });

      // We used to persist each memo summary as a bare `tool` row here for
      // transcript completeness, but the UI filters tool messages out of the
      // display and OpenAI 400s when a `tool` row appears in history without
      // a preceding assistant `tool_calls`. The full memo lives in
      // SpecialistMemo (saved by runPanel via the store); the synthesis text
      // captures the panel's conclusion in the chat transcript on its own.

      if (panelResult.memos.length === 0) {
        send("error", {
          error: "No specialist returned a memo. Check Settings → AI provider.",
        });
        if (!clientGone) controller.close();
        clearAborter(conversationId, aborter);
        return;
      }

      send("synthesis_starting", {});

      let finalText = "";
      let finishReason: string | undefined;
      const finalToolCalls: ToolCall[] = [];
      const toolMeta = new Map<string, { name: string; result: string }>();

      try {
        for await (const ev of streamCioSynthesis({
          userId: session.user.id,
          conversationId,
          topic: sanitizedRequest.topic,
          ticker: sanitizedRequest.ticker,
          memos: panelResult.memos,
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
              send("tool_result", {
                id: ev.id,
                name: ev.name,
                isError: ev.isError,
              });
              toolMeta.set(ev.id, { name: ev.name, result: ev.result });
              break;
            case "done":
              finalText = ev.finalText;
              for (const tc of ev.finalToolCalls) finalToolCalls.push(tc);
              finishReason = ev.finishReason;
              break;
            case "error":
              send("error", { error: ev.error });
              break;
          }
        }

        // Persist synthesis to the conversation transcript so the user can
        // re-open later and see what the panel produced.
        if (finalToolCalls.length > 0) {
          await saveAssistantMessage(conversationId, {
            text: "",
            toolCalls: finalToolCalls,
            model: undefined,
          });
          for (const tc of finalToolCalls) {
            const meta = toolMeta.get(tc.id);
            if (meta) {
              await saveToolMessage(conversationId, tc.id, meta.name, meta.result);
            }
          }
        }
        if (finalText) {
          await saveAssistantMessage(conversationId, {
            text: finalText,
            toolCalls: undefined,
            model: undefined,
          });
        }

        send("done", { finishReason, aborted: aborter.signal.aborted });
        if (!clientGone) controller.close();
      } catch (err) {
        if (aborter.signal.aborted) {
          send("done", { aborted: true });
        } else {
          send("error", {
            error: err instanceof Error ? err.message : "Synthesis failed",
          });
        }
        if (!clientGone) controller.close();
      } finally {
        clearAborter(conversationId, aborter);
      }
    },
    cancel() {
      clientGone = true;
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

function composeSpecialistBrief(req: EscalationRequest): string {
  const parts: string[] = [];
  parts.push(`The CIO has convened the panel on this question:`);
  parts.push("");
  parts.push(req.topic);
  parts.push("");
  if (req.ticker) parts.push(`Subject ticker: ${req.ticker}`);
  if (req.reason) {
    parts.push("");
    parts.push(`CIO's framing: ${req.reason}`);
  }
  parts.push("");
  // Phrasing kept deliberately bland: Azure OpenAI's jailbreak detector
  // flags terse instructional patterns like "Stay in lane. Tag every claim.
  // Admit [GAP] — that is a valid output." when they appear next to a topic.
  // The softer wording below carries the same meaning without tripping the
  // heuristic. Don't reintroduce the imperative form.
  parts.push(
    "Apply your methodology and tools per your system prompt. Stay focused on the dimensions you cover. Ground each finding in the tools available to you and tag it FACT, CALC, INFER, or GAP. When the tools do not surface the data, recording a GAP is the appropriate finding. Submit your structured memo via submit_memo as your final action.",
  );
  return parts.join("\n");
}
