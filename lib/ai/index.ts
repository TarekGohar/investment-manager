import "server-only";
import {
  createAzureOpenAiProvider,
  createOpenAiProvider,
} from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import type { AiProvider } from "./types";

export type { AiProvider, ChatMessage, StreamEvent, ToolDefinition } from "./types";

type ProviderName = "openai" | "azure-openai" | "anthropic";

/**
 * Logical roles for picking the right model per surface. The point is to keep
 * Opus for things that actually need it (chat, deep filings) and let Sonnet /
 * Haiku handle the rest. Cuts monthly burn ~4–5× vs running Opus everywhere.
 *
 *   chat       — PM chat with full tool-use. Conviction + multi-step reasoning.
 *   deep       — Quarterly + annual long-form reads. Long context, dense output.
 *   review     — Daily / weekly portfolio notes. Structured, repetitive shape.
 *   classifier — News severity + thesis-check JSON. One-shot, narrow output.
 */
export type ModelRole = "chat" | "deep" | "review" | "classifier";

function resolveProvider(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
  if (raw === "anthropic" || raw === "claude") return "anthropic";
  if (raw === "azure" || raw === "azure-openai" || raw === "azureopenai") {
    return "azure-openai";
  }
  return "openai";
}

/**
 * Per-role defaults. Override any of them via env:
 *   AI_MODEL_CHAT       — what the PM chat uses
 *   AI_MODEL_DEEP       — quarterly + annual reads
 *   AI_MODEL_REVIEW     — daily + weekly reviews
 *   AI_MODEL_CLASSIFIER — news + thesis-check
 *
 * AI_MODEL (legacy) is honored as a fallback for every role.
 */
const ROLE_DEFAULTS: Record<ProviderName, Record<ModelRole, string>> = {
  anthropic: {
    chat: "claude-opus-4-8",
    deep: "claude-opus-4-8",
    review: "claude-sonnet-4-6",
    classifier: "claude-haiku-4-5-20251001",
  },
  openai: {
    chat: "gpt-4o",
    deep: "gpt-4o",
    review: "gpt-4o-mini",
    classifier: "gpt-4o-mini",
  },
  // On Azure, "model" is the deployment name. There's typically one deployment,
  // so all roles default to it unless overridden per-role.
  "azure-openai": {
    chat: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
    deep: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
    review: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
    classifier: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
  },
};

const ROLE_ENV: Record<ModelRole, string> = {
  chat: "AI_MODEL_CHAT",
  deep: "AI_MODEL_DEEP",
  review: "AI_MODEL_REVIEW",
  classifier: "AI_MODEL_CLASSIFIER",
};

/**
 * Returns the configured provider. Switching providers is one env var change.
 */
export function getProvider(): AiProvider {
  const name = resolveProvider();
  switch (name) {
    case "azure-openai":
      return createAzureOpenAiProvider();
    case "anthropic":
      return new AnthropicProvider();
    case "openai":
    default:
      return createOpenAiProvider();
  }
}

/**
 * Resolve the model for a given logical role. Precedence per role:
 *   1. AI_MODEL_<ROLE>     (per-role override)
 *   2. AI_MODEL            (legacy single-model setting — covers every role)
 *   3. Provider default for that role
 *
 * Calling `getModel()` with no role argument returns the chat-role default,
 * preserving the prior call-site shape.
 */
export function getModel(role: ModelRole = "chat"): string {
  const provider = resolveProvider();
  const perRole = process.env[ROLE_ENV[role]];
  if (perRole && perRole.trim()) return perRole.trim();
  if (process.env.AI_MODEL && process.env.AI_MODEL.trim()) {
    return process.env.AI_MODEL.trim();
  }
  return ROLE_DEFAULTS[provider][role];
}

export function getProviderName(): ProviderName {
  return resolveProvider();
}
