import { openAICompatible } from "./openai-compatible.ts";
import type { ModelProvider } from "./types.ts";

export const HYPERBOLIC_BASE_URL = "https://api.hyperbolic.xyz/v1";

export interface HyperbolicOptions {
  /** Defaults to process.env.HYPERBOLIC_API_KEY (server-side only). */
  apiKey?: string;
  embeddingModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Known-good Hyperbolic serverless models for agent workloads. This catalog is
 * advisory — availability is controlled by Hyperbolic, and any model id the
 * account can access may be passed to `hyperbolic()` directly.
 */
export const HYPERBOLIC_MODELS = [
  {
    id: "meta-llama/Llama-3.3-70B-Instruct",
    label: "Llama 3.3 70B Instruct",
    contextWindow: 131072,
    toolCalling: true,
    notes: "Default general-purpose agent model.",
  },
  {
    id: "Qwen/Qwen3-235B-A22B",
    label: "Qwen3 235B (A22B MoE)",
    contextWindow: 131072,
    toolCalling: true,
    notes: "Strong reasoning + tool use; MoE pricing profile.",
  },
  {
    id: "deepseek-ai/DeepSeek-V3",
    label: "DeepSeek V3",
    contextWindow: 131072,
    toolCalling: true,
    notes: "High-throughput analysis workloads.",
  },
  {
    id: "deepseek-ai/DeepSeek-R1",
    label: "DeepSeek R1",
    contextWindow: 131072,
    toolCalling: false,
    notes: "Deliberate reasoning; slower, use for risk review steps.",
  },
  {
    id: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    label: "Llama 3.1 8B Instruct",
    contextWindow: 131072,
    toolCalling: true,
    notes: "Cheap routing / classification finches.",
  },
] as const;

export type HyperbolicModelId = (typeof HYPERBOLIC_MODELS)[number]["id"] | (string & {});

/**
 * Hyperbolic is Finch's first compute provider. Its API is OpenAI-compatible,
 * so this is a thin, replaceable binding — swapping providers is a one-line
 * change in an agent manifest, by design.
 */
export function hyperbolic(model: HyperbolicModelId, options: HyperbolicOptions = {}): ModelProvider {
  const apiKey = options.apiKey ?? (typeof process !== "undefined" ? process.env.HYPERBOLIC_API_KEY ?? "" : "");
  return openAICompatible({
    baseUrl: HYPERBOLIC_BASE_URL,
    apiKey,
    model,
    provider: "hyperbolic",
    label: `Hyperbolic · ${model}`,
    embeddingModel: options.embeddingModel,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
}
