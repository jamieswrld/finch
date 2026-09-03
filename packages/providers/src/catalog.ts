import { openAICompatible } from "./openai-compatible.ts";
import type { ModelProvider } from "./types.ts";

/**
 * The provider catalog.
 *
 * Every entry below speaks the OpenAI chat-completions shape, so each one is a
 * thin binding over the same adapter rather than a separate integration. That
 * is the whole point of the abstraction: changing where inference comes from
 * is configuration, not a rewrite.
 *
 * Several have genuinely free tiers, which matters for a public read-only
 * deployment — Flight School and preview nests should not cost per visitor.
 * Model ids are env-overridable because provider catalogs change faster than
 * this file does.
 */

export type ProviderCost = "free-tier" | "local" | "paid";

export interface ProviderSpec {
  id: string;
  label: string;
  baseUrl: string;
  /** Env var holding the key. Local providers need none. */
  envKey: string | null;
  /** Env var overriding the default model. */
  envModel: string;
  defaultModel: string;
  cost: ProviderCost;
  notes: string;
}

export const PROVIDER_CATALOG: ProviderSpec[] = [
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    envModel: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
    cost: "free-tier",
    notes: "Free tier with rate limits; very fast inference. Good default for public preview traffic.",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    envModel: "CEREBRAS_MODEL",
    defaultModel: "llama-3.3-70b",
    cost: "free-tier",
    notes: "Free tier with daily limits; fastest token throughput of the hosted options.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    envModel: "OPENROUTER_MODEL",
    // OpenRouter marks zero-cost models with a :free suffix.
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    cost: "free-tier",
    notes: "Routes to many models; :free variants cost nothing but are rate limited and can be busy.",
  },
  {
    id: "gemini",
    label: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    envModel: "GEMINI_MODEL",
    defaultModel: "gemini-2.0-flash",
    cost: "free-tier",
    notes: "Free tier via the OpenAI-compatible endpoint; generous limits for read-only workloads.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    envKey: null,
    envModel: "OLLAMA_MODEL",
    defaultModel: "llama3.2",
    cost: "local",
    notes: "Fully free and fully private — runs on your own machine. No key, no quota, no per-request cost.",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
    envModel: "TOGETHER_MODEL",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    cost: "paid",
    notes: "Paid per token, with occasional free models.",
  },
  {
    id: "hyperbolic",
    label: "Hyperbolic",
    baseUrl: "https://api.hyperbolic.xyz/v1",
    envKey: "HYPERBOLIC_API_KEY",
    envModel: "HYPERBOLIC_MODEL",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    cost: "paid",
    notes: "Paid per token; open-model serverless inference.",
  },
];

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name] || undefined;
}

export function getProviderSpec(id: string): ProviderSpec | undefined {
  return PROVIDER_CATALOG.find((spec) => spec.id === id);
}

/** Is this provider usable right now (key present, or none needed)? */
export function isProviderConfigured(spec: ProviderSpec): boolean {
  if (spec.envKey === null) return Boolean(readEnv("OLLAMA_BASE_URL")) || Boolean(readEnv("ENABLE_OLLAMA"));
  return Boolean(readEnv(spec.envKey));
}

/** Build a live provider from a catalog entry. */
export function providerFrom(spec: ProviderSpec, modelOverride?: string): ModelProvider {
  return openAICompatible({
    baseUrl: spec.baseUrl,
    // Local runtimes accept any non-empty bearer token.
    apiKey: spec.envKey ? readEnv(spec.envKey) ?? "" : "local",
    model: modelOverride ?? readEnv(spec.envModel) ?? spec.defaultModel,
    provider: spec.id,
    label: `${spec.label} · ${modelOverride ?? readEnv(spec.envModel) ?? spec.defaultModel}`,
  });
}

export interface ResolvedProvider {
  provider: ModelProvider;
  spec: ProviderSpec;
  model: string;
}

/**
 * Pick a provider from the environment, preferring free ones.
 *
 * Order: an explicit FINCH_PROVIDER wins; otherwise free tiers first, then
 * local, then paid. This is what makes a public deployment free by default —
 * an operator who sets only GROQ_API_KEY gets working previews at no cost.
 * Returns null when nothing is configured, so callers can say so rather than
 * failing obscurely.
 */
export function resolveProviderFromEnv(modelOverride?: string): ResolvedProvider | null {
  const explicit = readEnv("FINCH_PROVIDER");
  if (explicit) {
    const spec = getProviderSpec(explicit);
    if (spec && isProviderConfigured(spec)) {
      const model = modelOverride ?? readEnv(spec.envModel) ?? spec.defaultModel;
      return { provider: providerFrom(spec, model), spec, model };
    }
    return null;
  }

  const rank: Record<ProviderCost, number> = { "free-tier": 0, local: 1, paid: 2 };
  const candidates = PROVIDER_CATALOG.filter(isProviderConfigured).sort((a, b) => rank[a.cost] - rank[b.cost]);
  const spec = candidates[0];
  if (!spec) return null;
  const model = modelOverride ?? readEnv(spec.envModel) ?? spec.defaultModel;
  return { provider: providerFrom(spec, model), spec, model };
}

/** What an operator has actually configured — for honest status surfaces. */
export function providerStatus(): Array<{ id: string; label: string; cost: ProviderCost; configured: boolean; notes: string }> {
  return PROVIDER_CATALOG.map((spec) => ({
    id: spec.id,
    label: spec.label,
    cost: spec.cost,
    configured: isProviderConfigured(spec),
    notes: spec.notes,
  }));
}
