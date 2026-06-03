import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import type { ChatMessage, ToolCall } from "./types";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  createdAt: Date;
};

type RawContent = {
  text?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  result?: string;
};

function serialize(row: {
  id: string;
  role: string;
  content: Prisma.JsonValue;
  createdAt: Date;
}): StoredMessage {
  const c = (row.content as RawContent | null) ?? {};
  const role = row.role === "assistant" || row.role === "tool" ? row.role : "user";
  if (role === "tool") {
    return {
      id: row.id,
      role: "tool",
      text: c.result ?? "",
      toolCallId: c.toolCallId,
      toolName: c.name,
      createdAt: row.createdAt,
    };
  }
  return {
    id: row.id,
    role,
    text: c.text ?? "",
    toolCalls: c.toolCalls,
    createdAt: row.createdAt,
  };
}

export async function getLatestConversation(
  userId: string,
  scope: string | null = "portfolio",
): Promise<{ id: string; createdAt: Date } | null> {
  return await prisma.aIConversation.findFirst({
    where: { userId, scope: scope ?? null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, createdAt: true },
  });
}

export type ConversationSummary = {
  id: string;
  scope: string;
  title: string;
  updatedAt: Date;
  messageCount: number;
};

function deriveTitle(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/);
  const limited = words.slice(0, 8).join(" ");
  return words.length > 8 ? `${limited}…` : limited;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await prisma.aIConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
      _count: { select: { messages: true } },
    },
  });

  return rows.map((row) => {
    const firstUser = row.messages[0];
    const firstText =
      firstUser && firstUser.content
        ? ((firstUser.content as RawContent).text ?? "")
        : "";
    const scope = row.scope ?? "portfolio";
    const fallback = scope === "portfolio" ? "Portfolio chat" : `${scope} chat`;
    return {
      id: row.id,
      scope,
      title: deriveTitle(firstText) ?? fallback,
      updatedAt: row.updatedAt,
      messageCount: row._count.messages,
    };
  });
}

export async function getConversationById(
  userId: string,
  id: string,
): Promise<{ id: string; scope: string } | null> {
  const row = await prisma.aIConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, scope: true },
  });
  if (!row || row.userId !== userId) return null;
  return { id: row.id, scope: row.scope ?? "portfolio" };
}

export async function createConversation(
  userId: string,
  scope: string | null = "portfolio",
): Promise<{ id: string }> {
  return await prisma.aIConversation.create({
    data: { userId, scope: scope ?? null },
    select: { id: true },
  });
}

export async function getOrCreateConversation(
  userId: string,
  scope: string | null = "portfolio",
): Promise<{ id: string; createdAt: Date }> {
  const latest = await getLatestConversation(userId, scope);
  if (latest) return latest;
  return await prisma.aIConversation.create({
    data: { userId, scope: scope ?? null },
    select: { id: true, createdAt: true },
  });
}

export async function listMessages(conversationId: string): Promise<StoredMessage[]> {
  const rows = await prisma.aIMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serialize);
}

export async function saveUserMessage(conversationId: string, text: string) {
  await prisma.aIMessage.create({
    data: {
      conversationId,
      role: "user",
      content: { text } as Prisma.InputJsonValue,
    },
  });
  await prisma.aIConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

export async function saveAssistantMessage(
  conversationId: string,
  payload: {
    text: string;
    toolCalls?: ToolCall[];
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  },
) {
  await prisma.aIMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: {
        text: payload.text,
        toolCalls: payload.toolCalls,
      } as Prisma.InputJsonValue,
      model: payload.model,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
    },
  });
  await prisma.aIConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

export async function saveToolMessage(
  conversationId: string,
  toolCallId: string,
  name: string,
  result: string,
) {
  await prisma.aIMessage.create({
    data: {
      conversationId,
      role: "tool",
      content: { toolCallId, name, result } as Prisma.InputJsonValue,
    },
  });
}

/** Convert stored messages back into provider-neutral ChatMessage[] for replay. */
export function toChatHistory(stored: StoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of stored) {
    if (m.role === "user") {
      out.push({ role: "user", text: m.text });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", text: m.text, toolCalls: m.toolCalls });
    } else if (m.role === "tool" && m.toolCallId && m.toolName) {
      out.push({
        role: "tool",
        toolCallId: m.toolCallId,
        name: m.toolName,
        result: m.text,
      });
    }
  }
  return out;
}

export type MonthlyTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/**
 * Anthropic exposes no "remaining balance" endpoint, so we self-track spend.
 * Sums the Claude input + output tokens this app has burned on the user's own
 * AI messages in the current calendar month (UTC). Token counts are already
 * persisted per assistant message by the chat route, so this is a pure read.
 *
 * The `model startsWith "claude"` filter keeps the figure Anthropic-specific:
 * if AI_PROVIDER is OpenAI/Azure those rows don't match and the total is 0.
 */
export async function getMonthlyTokenUsage(userId: string): Promise<MonthlyTokenUsage> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = await prisma.aIMessage.aggregate({
    _sum: { inputTokens: true, outputTokens: true },
    where: {
      createdAt: { gte: monthStart },
      model: { startsWith: "claude" },
      conversation: { userId },
    },
  });
  const inputTokens = agg._sum.inputTokens ?? 0;
  const outputTokens = agg._sum.outputTokens ?? 0;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

export async function clearConversation(id: string) {
  await prisma.aIMessage.deleteMany({ where: { conversationId: id } });
  await prisma.aIConversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
}
