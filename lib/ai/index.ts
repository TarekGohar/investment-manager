import "server-only";
import {
  createAzureOpenAiProvider,
  createOpenAiProvider,
} from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import type { AiProvider } from "./types";

export type { AiProvider, ChatMessage, StreamEvent, ToolDefinition } from "./types";

type ProviderName = "openai" | "azure-openai" | "anthropic";

function resolveProvider(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
  if (raw === "anthropic" || raw === "claude") return "anthropic";
  if (raw === "azure" || raw === "azure-openai" || raw === "azureopenai") {
    return "azure-openai";
  }
  return "openai";
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  // On Azure, "model" is the deployment name. Fall back to the env var that
  // points at the deployment if AI_MODEL isn't explicitly set.
  "azure-openai": process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
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

export function getModel(): string {
  const provider = resolveProvider();
  return process.env.AI_MODEL ?? DEFAULT_MODELS[provider];
}

export function getProviderName(): ProviderName {
  return resolveProvider();
}
