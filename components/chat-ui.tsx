"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMenu } from "@/components/conversations-sidebar";
import { SparkleIcon } from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { AI_USAGE_REFRESH_EVENT } from "@/lib/events";
import type { ConversationSummary } from "@/lib/ai/queries";

type ToolStatus = "calling" | "done" | "error";

type ToolUse = {
  id: string;
  name: string;
  status: ToolStatus;
};

type DisplayMessage =
  | { role: "user"; id: string; text: string }
  | {
      role: "assistant";
      id: string;
      text: string;
      tools: ToolUse[];
      streaming: boolean;
      error?: string;
      /** Surfaced when the model stops for a non-clean finish_reason
       *  (length cap, content filter, abort). Helps the user tell a
       *  truncated/garbled response from a real bug. */
      warning?: string;
    };

const PORTFOLIO_SUGGESTIONS = [
  "How is my portfolio doing today?",
  "What's my biggest position and why?",
  "Walk me through my unrealized P&L by ticker",
  "Anything material in the news for my top holdings?",
];

function tickerSuggestions(ticker: string): string[] {
  return [
    `What's ${ticker} doing today and why?`,
    `Summarize the latest news on ${ticker}`,
    `Walk through the bull and bear case for ${ticker}`,
    `How is my ${ticker} position performing vs my cost basis?`,
  ];
}

export function ChatUI({
  initialMessages,
  initialConversationId,
  scope = "portfolio",
  conversations,
  currentId,
}: {
  initialMessages: DisplayMessage[];
  initialConversationId: string | null;
  /** "portfolio" for the global chat, or a ticker symbol for a per-position chat. */
  scope?: string;
  /** Recent conversations + active id, surfaced via the mobile chats menu. */
  conversations: ConversationSummary[];
  currentId: string | null;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const suggestions = useMemo(
    () =>
      scope === "portfolio" ? PORTFOLIO_SUGGESTIONS : tickerSuggestions(scope),
    [scope],
  );

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  async function send(text: string) {
    const userMessage: DisplayMessage = {
      role: "user",
      text,
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantMessage: DisplayMessage = {
      role: "assistant",
      text: "",
      id: assistantId,
      tools: [],
      streaming: true,
    };

    setMessages((m) => [...m, userMessage, assistantMessage]);
    setInput("");
    setPending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat(
      text,
      conversationId,
      scope,
      controller.signal,
      (event, data) => {
        setMessages((current) =>
          current.map((m) => {
            if (m.id !== assistantId || m.role !== "assistant") return m;

            switch (event) {
              case "meta": {
                if (data.conversationId && !conversationId) {
                  setConversationId(data.conversationId);
                }
                return m;
              }
              case "text":
                return { ...m, text: m.text + data.delta };
              case "tool_call":
                return {
                  ...m,
                  tools: [
                    ...m.tools,
                    { id: data.id, name: data.name, status: "calling" },
                  ],
                };
              case "tool_result":
                return {
                  ...m,
                  tools: m.tools.map((t) =>
                    t.id === data.id
                      ? { ...t, status: data.isError ? "error" : "done" }
                      : t,
                  ),
                };
              case "done":
                return { ...m, streaming: false };
              case "warning":
                return {
                  ...m,
                  warning: String(data.reason ?? "Stream ended unexpectedly."),
                };
              case "error":
                return {
                  ...m,
                  streaming: false,
                  error: String(data.error ?? "Error"),
                };
              default:
                return m;
            }
          }),
        );
      },
    );

    abortRef.current = null;
    setPending(false);

    // The route persists token usage before closing the stream, so by now the
    // DB reflects this turn — nudge the navbar counter to refetch and stay live.
    window.dispatchEvent(new Event(AI_USAGE_REFRESH_EVENT));
  }

  function stop() {
    abortRef.current?.abort();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;
    void send(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {messages.length === 0 ? (
          <EmptyState
            scope={scope}
            suggestions={suggestions}
            onPick={(s) => {
              setInput(s);
              textareaRef.current?.focus();
            }}
          />
        ) : (
          <div className="mx-auto max-w-3xl space-y-7">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-border bg-bg px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          <ChatMenu
            conversations={conversations}
            currentId={currentId}
            currentScope={scope}
          />
          <div className="flex-1 rounded-[20px] border border-border bg-panel px-4 py-3 transition-colors focus-within:border-brand">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your portfolio…"
              disabled={pending}
              rows={1}
              className="block w-full resize-none bg-transparent text-[15px] leading-relaxed text-text outline-none ring-0 focus:outline-none focus:ring-0 active:outline-none active:ring-0 placeholder:text-muted disabled:cursor-not-allowed"
              style={{ outline: "none", boxShadow: "none" }}
            />
          </div>
          {pending ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-panel-2 text-text transition-colors hover:bg-pill"
              aria-label="Stop generating">
              <StopIcon />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-brand to-brand-3 text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send">
              <SendIcon />
            </button>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-2">
          Research, not advice. Live quotes are 15-min delayed.
        </p>
      </form>
    </div>
  );
}

function EmptyState({
  scope,
  suggestions,
  onPick,
}: {
  scope: string;
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  const tickerScoped = scope !== "portfolio";
  return (
    <div className="mx-auto max-w-2xl pt-12 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-3">
        <SparkleIcon className="h-6 w-6 text-white" />
      </div>
      <h2 className="text-[24px] font-semibold leading-tight">
        {tickerScoped ? `Ask the PM about ${scope}` : "Talk to your PM"}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">
        {tickerScoped
          ? `Live quotes, news, fundamentals, and your ${scope} position history are fetched on demand.`
          : "Ask anything about your book. Quotes, news, fundamentals, and your own cost-basis history are fetched on demand."}
      </p>
      <div className="mt-10 grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-card border border-border bg-panel px-4 py-3 text-[14px] font-medium text-soft transition-colors hover:bg-panel-2">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: DisplayMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[20px] rounded-br-[6px] bg-brand px-4 py-2.5 text-[15px] leading-relaxed text-white">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-3">
          <SparkleIcon className="h-3 w-3 text-white" />
        </span>
        PM
      </div>
      {message.tools.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {message.tools.map((t) => (
            <ToolChip key={t.id} tool={t} />
          ))}
        </div>
      ) : null}
      {message.streaming &&
      message.text === "" &&
      message.tools.length === 0 ? (
        <div className="text-[15px] text-muted">Thinking…</div>
      ) : message.text.length > 0 ? (
        <div className="relative">
          <Markdown>{message.text}</Markdown>
          {message.streaming ? (
            <span className="ml-0.5 inline-block h-[16px] w-[2px] translate-y-[3px] animate-pulse bg-text" />
          ) : null}
        </div>
      ) : null}
      {message.warning ? (
        <div className="rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          ⚠ {message.warning}
        </div>
      ) : null}
      {message.error ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {message.error}
        </div>
      ) : null}
    </div>
  );
}

function ToolChip({ tool }: { tool: ToolUse }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors ${
        tool.status === "calling"
          ? "border-brand/40 bg-brand/10 text-brand-2"
          : tool.status === "error"
            ? "border-danger/40 bg-danger/10 text-danger"
            : "border-border bg-panel text-muted"
      }`}>
      {tool.status === "calling" ? (
        <DotLoader />
      ) : tool.status === "error" ? (
        "✗"
      ) : (
        "✓"
      )}
      <span className="font-mono">{tool.name}</span>
    </div>
  );
}

function DotLoader() {
  return (
    <span className="inline-flex gap-[2px]">
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-current" />
    </span>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

// ─── Stream parsing ─────────────────────────────────────────────────

async function streamChat(
  message: string,
  conversationId: string | null,
  scope: string,
  signal: AbortSignal,
  onEvent: (event: string, data: any) => void,
) {
  let response: Response;
  try {
    response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversationId, scope }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) {
      onEvent("done", { aborted: true });
      return;
    }
    const msg = err instanceof Error ? err.message : "Network error";
    onEvent("error", { error: msg });
    return;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    onEvent("error", { error: text || `HTTP ${response.status}` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!block.trim()) continue;

        let eventName = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!data) continue;
        try {
          onEvent(eventName, JSON.parse(data));
        } catch {
          // ignore malformed frame
        }
      }
    }
  } catch (err) {
    if (signal.aborted) {
      onEvent("done", { aborted: true });
      return;
    }
    const msg = err instanceof Error ? err.message : "Stream failed";
    onEvent("error", { error: msg });
  }
}
