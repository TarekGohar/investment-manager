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
  /** USD spend this month across all AI surfaces, computed from token counts × per-model pricing. */
  costUsd: number;
  /** Per-model-family breakdown so the UI can show what's burning the credits. */
  byFamily: Array<{
    family: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  /** Filter that was applied — useful for the UI label. */
  provider: "anthropic" | "openai" | "all";
};

/**
 * Anthropic / OpenAI don't expose a "remaining credits" endpoint on the
 * regular API key, so we self-track spend from the model + token columns
 * we persist on every AI row.
 *
 * Sources summed:
 *   - AIMessage (chat assistant turns)
 *   - AIAnalysis (daily/weekly/annual reviews, quarterly summaries, on-demand
 *     thesis reviews — all the cron + on-demand non-chat work)
 *
 * `provider` filters which rows count toward the total:
 *   "anthropic" → only models that look Claude-ish (default — matches the
 *                 UI label "Anthropic spend").
 *   "openai"    → only models that look GPT-ish.
 *   "all"       → every row regardless of family.
 */
export async function getMonthlyTokenUsage(
  userId: string,
  opts: { provider?: "anthropic" | "openai" | "all" } = {},
): Promise<MonthlyTokenUsage> {
  const provider = opts.provider ?? "anthropic";
  const { computeCostUsd, familyFor } = await import("@/lib/ai/pricing");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [messages, analyses] = await Promise.all([
    prisma.aIMessage.groupBy({
      by: ["model"],
      _sum: { inputTokens: true, outputTokens: true },
      where: {
        createdAt: { gte: monthStart },
        conversation: { userId },
      },
    }),
    prisma.aIAnalysis.groupBy({
      by: ["model"],
      _sum: { inputTokens: true, outputTokens: true },
      where: {
        generatedAt: { gte: monthStart },
        userId,
      },
    }),
  ]);

  const perModel = new Map<string, { input: number; output: number }>();
  function add(model: string | null, input: number | null, output: number | null) {
    if (!model || (!input && !output)) return;
    const slot = perModel.get(model) ?? { input: 0, output: 0 };
    slot.input += input ?? 0;
    slot.output += output ?? 0;
    perModel.set(model, slot);
  }
  for (const r of messages) add(r.model, r._sum.inputTokens, r._sum.outputTokens);
  for (const r of analyses) add(r.model, r._sum.inputTokens, r._sum.outputTokens);

  const familyAgg = new Map<string, { input: number; output: number; cost: number }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  for (const [model, tokens] of perModel) {
    if (provider === "anthropic" && !/claude/i.test(model)) continue;
    if (provider === "openai" && !/^(gpt|o1)/i.test(model)) continue;
    const cost = computeCostUsd({
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
    });
    const family = familyFor(model);
    const slot = familyAgg.get(family) ?? { input: 0, output: 0, cost: 0 };
    slot.input += tokens.input;
    slot.output += tokens.output;
    slot.cost += cost;
    familyAgg.set(family, slot);
    inputTokens += tokens.input;
    outputTokens += tokens.output;
    costUsd += cost;
  }

  const byFamily = Array.from(familyAgg.entries())
    .map(([family, v]) => ({
      family,
      inputTokens: v.input,
      outputTokens: v.output,
      costUsd: v.cost,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    byFamily,
    provider,
  };
}

export async function clearConversation(id: string) {
  await prisma.aIMessage.deleteMany({ where: { conversationId: id } });
  await prisma.aIConversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
}
