import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { ChatUI } from "@/components/chat-ui";
import { ClearChatButton } from "@/components/clear-chat-button";
import {
  ConversationsSidebar,
  NewChatButton,
} from "@/components/conversations-sidebar";
import { auth } from "@/lib/auth";
import {
  getConversationById,
  getLatestConversation,
  listConversations,
  listMessages,
} from "@/lib/ai/queries";
import type { ToolCall } from "@/lib/ai/types";

type ToolUse = { id: string; name: string; status: "done" | "calling" | "error" };

type DisplayMessage =
  | { role: "user"; id: string; text: string }
  | {
      role: "assistant";
      id: string;
      text: string;
      tools: ToolUse[];
      streaming: boolean;
    };

function normalizeScope(raw: string | undefined): string {
  if (!raw) return "portfolio";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "portfolio") return "portfolio";
  const candidate = trimmed.toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(candidate)) return "portfolio";
  return candidate;
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; ticker?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const params = await searchParams;
  const scopeFromTicker = normalizeScope(params.ticker);

  // Resolve the active conversation: explicit id wins, then latest-for-scope.
  let active: { id: string; scope: string } | null = null;
  if (params.id) {
    active = await getConversationById(session.user.id, params.id);
  }
  if (!active) {
    const latest = await getLatestConversation(session.user.id, scopeFromTicker);
    if (latest) active = { id: latest.id, scope: scopeFromTicker };
  }

  const scope = active?.scope ?? scopeFromTicker;
  const isPortfolio = scope === "portfolio";

  const [conversations, stored] = await Promise.all([
    listConversations(session.user.id),
    active ? listMessages(active.id) : Promise.resolve([]),
  ]);

  const initialMessages: DisplayMessage[] = stored
    .filter((m) => m.role !== "tool")
    .map<DisplayMessage>((m) => {
      if (m.role === "user") {
        return { role: "user", id: m.id, text: m.text };
      }
      const tools: ToolUse[] = (m.toolCalls ?? []).map((tc: ToolCall) => ({
        id: tc.id,
        name: tc.name,
        status: "done" as const,
      }));
      return {
        role: "assistant",
        id: m.id,
        text: m.text,
        tools,
        streaming: false,
      };
    });

  const hasHistory = initialMessages.length > 0;

  return (
    <>
      <Topbar
        title={isPortfolio ? "AI Chat" : `Ask PM · ${scope}`}
        backHref={isPortfolio ? undefined : `/positions/${scope}`}
        rightSlot={
          <div className="flex items-center gap-2">
            <NewChatButton scope={scope} />
            <ClearChatButton scope={scope} disabled={!hasHistory} />
          </div>
        }
      />
      <div className="flex">
        <ConversationsSidebar
          conversations={conversations}
          currentId={active?.id ?? null}
          currentScope={scope}
        />
        <div className="min-w-0 flex-1">
          <ChatUI
            key={active?.id ?? "empty"}
            initialMessages={initialMessages}
            initialConversationId={active?.id ?? null}
            scope={scope}
          />
        </div>
      </div>
    </>
  );
}
