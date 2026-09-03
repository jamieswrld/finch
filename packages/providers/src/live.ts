import { resolveProviderChain, type ModelPreference, type ResolvedProvider } from "./catalog.ts";
import { probeProviders } from "./probe.ts";

/**
 * The provider chain, minus anything the probe knows is dead.
 *
 * The failover wrapper marks a provider dead when it answers 401 — but a nest
 * dispatches its parallel tasks before any of them has had that answer, so a
 * whole burst can walk into the same dead key at once. Filtering at
 * chain-build time closes that: a credential the probe has already seen
 * rejected is never in the chain to begin with. The probe is cached, so this
 * costs nothing per run.
 */
export interface LiveChain {
  chain: ResolvedProvider[];
  /** Provider ids excluded because their key was rejected. */
  excluded: string[];
  /** True when every live provider is a free tier — the caller should not fan out. */
  freeTierOnly: boolean;
}

export async function resolveLiveChain(preferred?: ModelPreference): Promise<LiveChain> {
  const [full, probes] = await Promise.all([Promise.resolve(resolveProviderChain(preferred)), probeProviders()]);
  const invalid = new Set(probes.filter((probe) => probe.status === "invalid").map((probe) => probe.id));
  const chain = full.filter((entry) => !invalid.has(entry.spec.id));
  return {
    chain,
    excluded: full.filter((entry) => invalid.has(entry.spec.id)).map((entry) => entry.spec.id),
    freeTierOnly: chain.length > 0 && chain.every((entry) => entry.spec.cost !== "paid"),
  };
}

/**
 * How wide a nest may fan out on this chain.
 *
 * A free tier is a tokens-per-minute budget. Three tool-heavy finches at once
 * exceed it on the first turn, every task 429s, and the nest halts having
 * done nothing. One at a time is slower and finishes. When a paid provider is
 * live, the nest's own policy stands.
 */
export function effectiveParallelism(live: LiveChain, requested: number): { value: number; reason: string } {
  if (live.chain.length === 0) return { value: 1, reason: "no provider configured" };
  if (live.freeTierOnly && requested > 1) {
    return { value: 1, reason: "sequential — every live provider is a free tier with a per-minute token budget" };
  }
  return { value: requested, reason: requested > 1 ? "parallel — a paid provider is live" : "sequential by policy" };
}
