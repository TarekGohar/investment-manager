"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createChatAction } from "@/app/actions/chat";
import type { ConversationSummary } from "@/lib/ai/queries";

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ConversationsSidebar({
  conversations,
  currentId,
  currentScope,
}: {
  conversations: ConversationSummary[];
  currentId: string | null;
  currentScope: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function newChat() {
    if (pending) return;
    startTransition(async () => {
      const { id } = await createChatAction(currentScope);
      router.push(`/chat?id=${id}`);
    });
  }

  return (
    <aside className="hidden h-full w-[260px] shrink-0 flex-col border-r border-border bg-bg lg:flex">
      <div className="border-b border-border p-3">
        <button
          type="button"
          onClick={newChat}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-brand to-brand-3 py-2.5 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
        >
          {pending ? "Creating…" : "+ New chat"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted">No conversations yet.</div>
        ) : (
          conversations.map((c) => {
            const active = c.id === currentId;
            const isTicker = c.scope !== "portfolio";
            return (
              <Link
                key={c.id}
                href={`/chat?id=${c.id}`}
                className={`block rounded-[10px] px-3 py-2.5 transition-colors ${
                  active ? "bg-panel" : "hover:bg-panel"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-[13px] font-semibold text-text">
                    {c.title}
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-2">
                    {timeAgo(c.updatedAt)}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                  <span
                    className={`inline-block rounded-full px-1.5 py-0.5 ${
                      isTicker
                        ? "bg-brand/15 text-brand-2"
                        : "bg-pill text-muted"
                    }`}
                  >
                    {isTicker ? c.scope : "Portfolio"}
                  </span>
                  <span>{c.messageCount} msg{c.messageCount === 1 ? "" : "s"}</span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
}

export function NewChatButton({ scope }: { scope: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function newChat() {
    if (pending) return;
    startTransition(async () => {
      const { id } = await createChatAction(scope);
      router.push(`/chat?id=${id}`);
    });
  }

  return (
    <button
      type="button"
      onClick={newChat}
      disabled={pending}
      className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-panel px-3 text-[13px] font-semibold text-text transition-colors hover:bg-panel-2 disabled:opacity-60"
    >
      {pending ? "…" : "+ New"}
    </button>
  );
}
