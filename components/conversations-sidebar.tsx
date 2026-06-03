"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

/** A single recent-conversation row, shared by the sidebar and the mobile menu. */
function ConversationLink({
  conversation,
  active,
  onSelect,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect?: () => void;
}) {
  const isTicker = conversation.scope !== "portfolio";
  return (
    <Link
      href={`/chat?id=${conversation.id}`}
      onClick={onSelect}
      className={`block rounded-[10px] px-3 py-2.5 transition-colors ${
        active ? "bg-panel" : "hover:bg-panel"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[13px] font-semibold text-text">
          {conversation.title}
        </div>
        <div className="shrink-0 text-[11px] text-muted-2">
          {timeAgo(conversation.updatedAt)}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span
          className={`inline-block rounded-full px-1.5 py-0.5 ${
            isTicker ? "bg-brand/15 text-brand-2" : "bg-pill text-muted"
          }`}
        >
          {isTicker ? conversation.scope : "Portfolio"}
        </span>
        <span>
          {conversation.messageCount} msg{conversation.messageCount === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
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
          conversations.map((c) => (
            <ConversationLink
              key={c.id}
              conversation={c}
              active={c.id === currentId}
            />
          ))
        )}
      </div>
    </aside>
  );
}

/**
 * Mobile-only counterpart to the sidebar: a button that lives next to the chat
 * input and opens a dropdown *upward* (it sits at the bottom of the screen)
 * with "New chat" and the recent-conversation list. Hidden on lg+ where the
 * full sidebar is shown instead.
 */
export function ChatMenu({
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
  const [open, setOpen] = useState(false);

  function newChat() {
    if (pending) return;
    setOpen(false);
    startTransition(async () => {
      const { id } = await createChatAction(currentScope);
      router.push(`/chat?id=${id}`);
    });
  }

  return (
    <div className="relative shrink-0 lg:hidden">
      {open && (
        <>
          {/* Click-away backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div className="absolute bottom-full left-0 z-30 mb-2 flex max-h-[60vh] w-[min(280px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[16px] border border-border bg-bg shadow-xl">
            <div className="border-b border-border p-2">
              <button
                type="button"
                onClick={newChat}
                disabled={pending}
                className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-brand to-brand-3 py-2.5 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
              >
                {pending ? "Creating…" : "+ New chat"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {conversations.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted">
                  No conversations yet.
                </div>
              ) : (
                conversations.map((c) => (
                  <ConversationLink
                    key={c.id}
                    conversation={c}
                    active={c.id === currentId}
                    onSelect={() => setOpen(false)}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Chats menu"
        className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-border bg-panel text-text transition-colors hover:bg-panel-2"
      >
        <ChatsIcon />
      </button>
    </div>
  );
}

function ChatsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
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
