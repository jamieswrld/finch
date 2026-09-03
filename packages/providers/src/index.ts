export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatRole,
  ChatStreamDelta,
  EmbedRequest,
  EmbedResponse,
  FinishReason,
  ModelProvider,
  ModelProviderInfo,
  ModelRef,
  ProviderCapabilities,
  TokenUsage,
  ToolCall,
  ToolSpec,
} from "./types.ts";

export { ProviderError, withRetries, type ProviderErrorCode } from "./errors.ts";
export { openAICompatible, type OpenAICompatibleOptions } from "./openai-compatible.ts";
export {
  PROVIDER_CATALOG,
  getProviderSpec,
  isProviderConfigured,
  providerFrom,
  providerStatus,
  resolveProviderFromEnv,
  type ProviderCost,
  type ProviderSpec,
  type ResolvedProvider,
} from "./catalog.ts";
export {
  HYPERBOLIC_BASE_URL,
  HYPERBOLIC_MODELS,
  hyperbolic,
  type HyperbolicModelId,
  type HyperbolicOptions,
} from "./hyperbolic.ts";

import { hyperbolic } from "./hyperbolic.ts";
import { openAICompatible, type OpenAICompatibleOptions } from "./openai-compatible.ts";
import type { ModelProvider, ModelRef } from "./types.ts";

/**
 * Resolve a serializable ModelRef (as stored in a Finch manifest) to a live
 * provider. New providers register here — one switch, no coupling elsewhere.
 */
export function resolveModel(
  ref: ModelRef,
  overrides?: { apiKey?: string; custom?: (ref: ModelRef) => ModelProvider | undefined; openAICompatible?: Omit<OpenAICompatibleOptions, "model" | "provider"> },
): ModelProvider {
  const custom = overrides?.custom?.(ref);
  if (custom) return custom;
  switch (ref.provider) {
    case "hyperbolic":
      return hyperbolic(ref.model, { apiKey: overrides?.apiKey });
    case "openai-compatible": {
      if (!overrides?.openAICompatible) {
        throw new Error("resolveModel: provider 'openai-compatible' requires baseUrl/apiKey overrides");
      }
      return openAICompatible({ ...overrides.openAICompatible, model: ref.model, provider: "openai-compatible" });
    }
    default:
      throw new Error(`resolveModel: unknown provider "${ref.provider}". Register it in @finch/providers.`);
  }
}
