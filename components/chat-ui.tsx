"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMenu } from "@/components/conversations-sidebar";
import { SparkleIcon } from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { AI_USAGE_REFRESH_EVENT } from "@/lib/events";
import type { ConversationSummary } from "@/lib/ai/queries";
import type { ToolCall } from "@/lib/ai/types";

type ToolStatus = "calling" | "done" | "error";

// Shape returned by GET /api/ai/conversations/[id]/messages. Mirrors
// StoredMessage from lib/ai/queries.ts but typed locally so this client
// component doesn't pull in the server-only module.
type StoredMessageRow = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  toolCalls?: ToolCall[];
};

function toDisplayMessages(rows: StoredMessageRow[]): DisplayMessage[] {
  return rows
    .filter((m) => m.role !== "tool")
    .map<DisplayMessage>((m) => {
      if (m.role === "user") {
        return { role: "user", id: m.id, text: m.text };
      }
      const tools: ToolUse[] = (m.toolCalls ?? []).map((tc) => ({
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
}

type ToolUse = {
  id: string;
  name: string;
  status: ToolStatus;
};

type DecisionPill = { id: string; url: string };

/** EscalationRequest payload carried by the `escalation_requested` SSE event.
 *  Mirrors `lib/ai/panel/types.ts:EscalationRequest` — duplicated here so
 *  this client component doesn't pull in the server module. */
type ClientEscalationRequest = {
  topic: string;
  ticker: string | null;
  reason: string;
  recommendedSpecialists: string[];
};

type SpecialistStatus = "queued" | "running" | "done" | "error";

type PanelRun = {
  status:
    | "awaiting_confirm"
    | "running"
    | "synthesizing"
    | "complete"
    | "error"
    | "dismissed";
  request: ClientEscalationRequest;
  /** Per-specialist status by role name. */
  specialists: Record<
    string,
    { status: SpecialistStatus; durationMs?: number; error?: string }
  >;
  /** Wall-clock start when /panel/confirm POST began (unix ms). */
  startedAt?: number;
  /** Wall-clock complete (unix ms). */
  completedAt?: number;
  errorMsg?: string;
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
      /** Decision Hub entries raised by `propose_decision` during this turn. */
      decisions?: DecisionPill[];
      /** Live state of an investment-committee panel request originating
       *  from this assistant turn. Set when `escalation_requested` fires
       *  and updated through the panel-confirm SSE stream. */
      panel?: PanelRun;
      /** Synthesized text + tools streamed back from /panel/confirm. Lives
       *  alongside the assistant's own `text`/`tools` so the CIO's pre-panel
       *  framing and the post-panel synthesis don't overwrite each other. */
      synthesisText?: string;
      synthesisTools?: ToolUse[];
      synthesisStreaming?: boolean;
    };

const SPECIALIST_LABELS: Record<string, string> = {
  BUSINESS_ANALYST: "Business Analyst",
  VALUATION_ANALYST: "Valuation Analyst",
  RISK_PORTFOLIO: "Risk & Portfolio",
  TAX_STRATEGIST: "Tax Strategist",
  BEHAVIORAL_COACH: "Behavioral Coach",
  MACRO_INDUSTRY: "Macro & Industry",
  DEVILS_ADVOCATE: "Devil's Advocate",
  CAPITAL_ALLOCATOR: "Capital Allocator",
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
  const panelAbortRef = useRef<AbortController | null>(null);
  // Mirrors of state used inside event handlers that would otherwise capture
  // stale closures (e.g. the visibilitychange listener).
  const messagesRef = useRef(messages);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  const userStoppedRef = useRef(false);

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

  // Reconciles in-flight assistant message(s) with the persisted server state.
  // Mobile browsers tear down the SSE connection when the tab is backgrounded,
  // so the client-side stream ends in an error even though the server route
  // keeps going and persists the answer. When the user returns we refetch
  // the conversation and replace any stuck/errored assistant message with
  // the version the server actually saved.
  const reconcileFromServer = useCallback(async () => {
    const convId = conversationIdRef.current;
    if (!convId) return;
    try {
      const res = await fetch(`/api/ai/conversations/${convId}/messages`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: StoredMessageRow[] };
      const fresh = toDisplayMessages(data.messages);
      setMessages(fresh);
    } catch {
      // Best-effort — leave UI as is if the refetch fails.
    }
  }, []);

  // On tab focus regained, if we have a stuck assistant message, refetch.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      const stuck = messagesRef.current.some(
        (m) => m.role === "assistant" && (m.streaming || m.error),
      );
      if (!stuck) return;
      void reconcileFromServer();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [reconcileFromServer]);

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

    // Tracks whether the upstream stream signalled a clean `done`. Set inside
    // the SSE dispatcher (where new state is correctly observable), then read
    // synchronously after streamChat resolves. We need this because
    // `messagesRef.current` does NOT sync with `setMessages` updates until
    // after the next render — so the post-stream stuck check would otherwise
    // see `streaming: true` for one tick and wrongly fire `reconcileFromServer`,
    // wiping client-only state like the panel-confirm button.
    let receivedDone = false;

    await streamChat(
      text,
      conversationId,
      scope,
      controller.signal,
      (event, data) => {
        if (event === "done") receivedDone = true;
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
              case "tool_call": {
                // If the model already streamed some prose, insert a paragraph
                // break so any post-tool prose renders as a new paragraph
                // rather than gluing onto the previous sentence.
                const needsBreak = m.text.length > 0 && !m.text.endsWith("\n\n");
                return {
                  ...m,
                  text: needsBreak ? m.text + "\n\n" : m.text,
                  tools: [
                    ...m.tools,
                    { id: data.id, name: data.name, status: "calling" },
                  ],
                };
              }
              case "tool_result":
                return {
                  ...m,
                  tools: m.tools.map((t) =>
                    t.id === data.id
                      ? { ...t, status: data.isError ? "error" : "done" }
                      : t,
                  ),
                };
              case "decision_raised":
                return {
                  ...m,
                  decisions: [
                    ...(m.decisions ?? []),
                    { id: String(data.decisionId), url: String(data.url) },
                  ],
                };
              case "escalation_requested": {
                // CIO has requested a panel run via request_panel. The user
                // confirms via the bubble's "Convene panel" button — we don't
                // fire anything here.
                const req: ClientEscalationRequest = {
                  topic: String(data.topic ?? ""),
                  ticker: data.ticker ? String(data.ticker) : null,
                  reason: String(data.reason ?? ""),
                  recommendedSpecialists: Array.isArray(data.recommendedSpecialists)
                    ? data.recommendedSpecialists.map(String)
                    : [],
                };
                const specialists: PanelRun["specialists"] = {};
                for (const s of req.recommendedSpecialists) {
                  specialists[s] = { status: "queued" };
                }
                return {
                  ...m,
                  panel: {
                    status: "awaiting_confirm",
                    request: req,
                    specialists,
                  },
                };
              }
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

    // If the stream ended unhappily (network drop, server error) and the user
    // didn't explicitly stop, the server may have continued and persisted the
    // answer anyway. Reconcile from the DB so the user sees the real result
    // instead of a stranded error pill.
    const wasUserStopped = userStoppedRef.current;
    userStoppedRef.current = false;
    // Only reconcile when the stream did NOT signal a clean `done`. A clean
    // done means the server finished and persisted on its own; reconciling
    // would refetch the persisted message (which lacks client-only state
    // like the panel-confirm card) and clobber what's on screen.
    if (!wasUserStopped && !receivedDone) {
      void reconcileFromServer();
    }
  }

  function stop() {
    userStoppedRef.current = true;
    // Tell the server to cancel the upstream model call. Best-effort:
    // on serverless this may miss if the /stop request lands on a
    // different instance than the /chat request, but on this app's
    // traffic profile they typically share a warm lambda. We fire-and-
    // forget so the UI can close immediately.
    const convId = conversationIdRef.current;
    if (convId) {
      void fetch("/api/ai/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId }),
      }).catch(() => {});
    }
    abortRef.current?.abort();
  }

  async function confirmPanel(messageId: string) {
    const convId = conversationIdRef.current;
    if (!convId) return;
    const target = messagesRef.current.find(
      (m) => m.id === messageId && m.role === "assistant",
    );
    if (!target || target.role !== "assistant" || !target.panel) return;
    const request = target.panel.request;

    const controller = new AbortController();
    panelAbortRef.current = controller;

    // Move from "awaiting_confirm" to "running" and prepare synthesis buffers.
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== messageId || m.role !== "assistant" || !m.panel) return m;
        return {
          ...m,
          panel: {
            ...m.panel,
            status: "running",
            startedAt: Date.now(),
          },
          synthesisText: "",
          synthesisTools: [],
          synthesisStreaming: true,
        };
      }),
    );

    await streamPanelConfirm(convId, request, controller.signal, (event, data) => {
      setMessages((current) =>
        current.map((m) => {
          if (m.id !== messageId || m.role !== "assistant" || !m.panel) return m;
          return applyPanelEvent(m, event, data);
        }),
      );
    });

    panelAbortRef.current = null;
    window.dispatchEvent(new Event(AI_USAGE_REFRESH_EVENT));
  }

  function dismissPanel(messageId: string) {
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== messageId || m.role !== "assistant" || !m.panel) return m;
        return { ...m, panel: { ...m.panel, status: "dismissed" } };
      }),
    );
  }

  function stopPanel(messageId: string) {
    panelAbortRef.current?.abort();
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== messageId || m.role !== "assistant" || !m.panel) return m;
        return {
          ...m,
          panel: {
            ...m.panel,
            status: "error",
            errorMsg: "Stopped by user.",
            completedAt: Date.now(),
          },
          synthesisStreaming: false,
        };
      }),
    );
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
              <MessageRow
                key={m.id}
                message={m}
                onConfirmPanel={confirmPanel}
                onDismissPanel={dismissPanel}
                onStopPanel={stopPanel}
              />
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

// Applies a panel-confirm SSE event to a single assistant message. Pure —
// returns a new message or the same reference if the event is irrelevant.
function applyPanelEvent(
  m: Extract<DisplayMessage, { role: "assistant" }>,
  event: string,
  data: any,
): DisplayMessage {
  if (!m.panel) return m;
  switch (event) {
    case "specialist_started": {
      const name = String(data.specialist);
      return {
        ...m,
        panel: {
          ...m.panel,
          specialists: {
            ...m.panel.specialists,
            [name]: {
              ...(m.panel.specialists[name] ?? { status: "queued" as SpecialistStatus }),
              status: "running" as SpecialistStatus,
            },
          },
        },
      };
    }
    case "specialist_completed": {
      const name = String(data.specialist);
      const success = Boolean(data.success);
      return {
        ...m,
        panel: {
          ...m.panel,
          specialists: {
            ...m.panel.specialists,
            [name]: {
              status: (success ? "done" : "error") as SpecialistStatus,
              durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
              error: data.error ? String(data.error) : undefined,
            },
          },
        },
      };
    }
    case "synthesis_starting":
      return { ...m, panel: { ...m.panel, status: "synthesizing" } };
    case "text":
      return { ...m, synthesisText: (m.synthesisText ?? "") + String(data.delta ?? "") };
    case "tool_call":
      return {
        ...m,
        synthesisTools: [
          ...(m.synthesisTools ?? []),
          { id: String(data.id), name: String(data.name), status: "calling" as ToolStatus },
        ],
      };
    case "tool_result":
      return {
        ...m,
        synthesisTools: (m.synthesisTools ?? []).map((t) =>
          t.id === String(data.id)
            ? { ...t, status: (data.isError ? "error" : "done") as ToolStatus }
            : t,
        ),
      };
    case "done":
      return {
        ...m,
        panel: {
          ...m.panel,
          status: m.panel.errorMsg ? "error" : "complete",
          completedAt: Date.now(),
        },
        synthesisStreaming: false,
      };
    case "error":
      return {
        ...m,
        panel: {
          ...m.panel,
          status: "error",
          errorMsg: String(data.error ?? "Panel run failed"),
          completedAt: Date.now(),
        },
        synthesisStreaming: false,
      };
    default:
      return m;
  }
}

type MessageRowProps = {
  message: DisplayMessage;
  onConfirmPanel: (messageId: string) => void;
  onDismissPanel: (messageId: string) => void;
  onStopPanel: (messageId: string) => void;
};

function MessageRow({ message, onConfirmPanel, onDismissPanel, onStopPanel }: MessageRowProps) {
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
      {message.decisions && message.decisions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {message.decisions.map((d) => (
            <a
              key={d.id}
              href={d.url}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-2/40 bg-brand-2/10 px-3 py-1 text-xs font-semibold text-brand-2 transition-colors hover:bg-brand-2/20"
            >
              📌 Decision raised → view
            </a>
          ))}
        </div>
      ) : null}
      {message.panel ? (
        <PanelCard
          panel={message.panel}
          synthesisText={message.synthesisText}
          synthesisTools={message.synthesisTools}
          synthesisStreaming={message.synthesisStreaming}
          onConfirm={() => onConfirmPanel(message.id)}
          onDismiss={() => onDismissPanel(message.id)}
          onStop={() => onStopPanel(message.id)}
        />
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

async function consumeSse(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: string, data: any) => void,
) {
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
  await consumeSse(response, signal, onEvent);
}

/**
 * POSTs the user-confirmed escalation request to /api/ai/chat/panel/confirm
 * and pipes the SSE events back through onEvent. Events the caller should
 * handle: panel_running, specialist_started, specialist_completed,
 * panel_complete, synthesis_starting, plus the standard text/tool/done/error
 * frames during the synthesis pass.
 */
async function streamPanelConfirm(
  conversationId: string,
  request: ClientEscalationRequest,
  signal: AbortSignal,
  onEvent: (event: string, data: any) => void,
) {
  let response: Response;
  try {
    response = await fetch("/api/ai/chat/panel/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, request }),
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
  await consumeSse(response, signal, onEvent);
}

// ─── Panel UI ───────────────────────────────────────────────────────

function PanelCard({
  panel,
  synthesisText,
  synthesisTools,
  synthesisStreaming,
  onConfirm,
  onDismiss,
  onStop,
}: {
  panel: PanelRun;
  synthesisText: string | undefined;
  synthesisTools: ToolUse[] | undefined;
  synthesisStreaming: boolean | undefined;
  onConfirm: () => void;
  onDismiss: () => void;
  onStop: () => void;
}) {
  if (panel.status === "dismissed") return null;
  if (panel.status === "awaiting_confirm") {
    return (
      <EscalationConfirmCard
        request={panel.request}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    );
  }
  return (
    <div className="space-y-3">
      <PanelProgressCard
        panel={panel}
        synthesisStreaming={Boolean(synthesisStreaming)}
        onStop={onStop}
      />
      {synthesisText && synthesisText.length > 0 ? (
        <div className="rounded-[16px] border border-brand-2/30 bg-brand-2/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-2">
            CIO Synthesis
          </div>
          {synthesisTools && synthesisTools.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {synthesisTools.map((t) => (
                <ToolChip key={t.id} tool={t} />
              ))}
            </div>
          ) : null}
          <div className="relative">
            <Markdown>{synthesisText}</Markdown>
            {synthesisStreaming ? (
              <span className="ml-0.5 inline-block h-[16px] w-[2px] translate-y-[3px] animate-pulse bg-text" />
            ) : null}
          </div>
        </div>
      ) : null}
      {panel.errorMsg ? (
        <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {panel.errorMsg}
        </div>
      ) : null}
    </div>
  );
}

function EscalationConfirmCard({
  request,
  onConfirm,
  onDismiss,
}: {
  request: ClientEscalationRequest;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-brand/40 bg-brand/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-2" />
        Convene the panel?
      </div>
      <p className="mb-3 text-[14px] leading-relaxed text-text">
        {request.reason || "Specialists will produce structured memos and the CIO will synthesize."}
      </p>
      <div className="mb-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Specialists ({request.recommendedSpecialists.length})
        </div>
        <ul className="space-y-0.5 text-[13px] text-text">
          {request.recommendedSpecialists.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span className="text-muted">·</span>
              {SPECIALIST_LABELS[s] ?? s}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-2"
        >
          Convene panel
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full border border-border bg-panel px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:text-text"
        >
          Not now
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Estimated time: 2–3 minutes. Costs Opus tokens for each specialist memo plus the synthesis pass.
      </p>
    </div>
  );
}

function PanelProgressCard({
  panel,
  synthesisStreaming,
  onStop,
}: {
  panel: PanelRun;
  synthesisStreaming: boolean;
  onStop: () => void;
}) {
  const elapsed = useLiveElapsed(panel.startedAt, panel.completedAt, panel.status);
  const inFlight = panel.status === "running" || panel.status === "synthesizing";

  const specialists = Object.entries(panel.specialists);
  const doneCount = specialists.filter(([, s]) => s.status === "done").length;
  const errorCount = specialists.filter(([, s]) => s.status === "error").length;

  let headerStatus = "Convening panel";
  if (panel.status === "synthesizing") headerStatus = "Synthesizing memos";
  else if (panel.status === "complete") headerStatus = "Panel complete";
  else if (panel.status === "error") headerStatus = "Panel error";

  return (
    <div className="rounded-[16px] border border-brand-2/30 bg-brand-2/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-2">
            {inFlight ? <DotLoader /> : null}
            Investment-committee panel
          </div>
          <div className="mt-0.5 text-[13px] text-text">
            {headerStatus}
            {" · "}
            <span className="tabular-nums">{formatElapsed(elapsed)}</span>
            {doneCount + errorCount > 0 ? (
              <span className="text-muted">
                {" · "}
                {doneCount}/{specialists.length} done
                {errorCount > 0 ? `, ${errorCount} error` : ""}
              </span>
            ) : null}
          </div>
        </div>
        {inFlight ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-full border border-border bg-panel px-3 py-1 text-xs font-semibold text-muted transition-colors hover:text-text"
          >
            Stop
          </button>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {specialists.map(([name, s]) => (
          <li
            key={name}
            className="flex items-center justify-between gap-3 rounded-md bg-panel/40 px-3 py-1.5 text-[13px]"
          >
            <div className="flex items-center gap-2.5">
              <SpecialistStatusIndicator status={s.status} />
              <span className={s.status === "running" ? "text-text" : "text-muted"}>
                {SPECIALIST_LABELS[name] ?? name}
              </span>
            </div>
            <span className="tabular-nums text-[11px] text-muted">
              {s.status === "done" && typeof s.durationMs === "number"
                ? formatElapsed(s.durationMs)
                : s.status === "error"
                  ? "error"
                  : s.status === "running"
                    ? "running…"
                    : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpecialistStatusIndicator({ status }: { status: SpecialistStatus }) {
  if (status === "running") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center text-brand-2">
        <DotLoader />
      </span>
    );
  }
  if (status === "done") {
    return <span className="inline-block h-4 w-4 text-center text-brand-2">✓</span>;
  }
  if (status === "error") {
    return <span className="inline-block h-4 w-4 text-center text-danger">✗</span>;
  }
  return <span className="inline-block h-4 w-4 text-center text-muted">·</span>;
}

function useLiveElapsed(
  startedAt: number | undefined,
  completedAt: number | undefined,
  status: PanelRun["status"],
): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "running" && status !== "synthesizing") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);
  if (!startedAt) return 0;
  if (completedAt) return completedAt - startedAt;
  return now - startedAt;
}

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
