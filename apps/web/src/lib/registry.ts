import type { AviaryListing } from "@finch/db";
import { NEST_PRESETS } from "./nest-presets";
import { SCHOOL_PRESETS } from "./school-presets";

/**
 * The registry: what actually exists and can actually be run.
 *
 * This replaces a seed file of sixteen invented listings — ticker-relay,
 * risk-warden, memory-loom, swarm-conductor and friends — which described
 * agents that did not exist, could not be opened, and could not be run. A
 * catalog of things you cannot use is not a catalog, and labelling it "seed"
 * only told the reader they were looking at a mock-up.
 *
 * Every entry below is derived from a real manifest that this deployment
 * executes. Open one, run it, and the same document is what the runtime
 * hatches. Nothing here is decorative.
 *
 * Stats are deliberately unglamorous. `calls30d` is filled in from actual run
 * history by the caller when it has it, and is otherwise 0 — never a
 * flattering guess. `uptime90d` is null because nothing measures uptime yet,
 * and "100%" would be a fabrication dressed as a metric.
 */

/** Category assignments reflect what each finch's tools actually touch. */
const FINCH_CATEGORY: Record<string, AviaryListing["category"]> = {
  "market-scout": "trading",
  "pons-scout": "research",
  "rwa-researcher": "rwa",
  watchtower: "data",
  "developer-finch": "tools",
};

const CREATED_AT = "2026-09-01T00:00:00.000Z";

function listingFromFinch(preset: (typeof SCHOOL_PRESETS)[number]): AviaryListing {
  return {
    slug: preset.slug,
    name: preset.title,
    category: FINCH_CATEGORY[preset.slug] ?? "agents",
    description: preset.blurb,
    creator: { name: "Finch" },
    stats: { calls30d: 0, uptime90d: null },
    // Read-only finches cost the operator inference and nothing else, so they
    // are free to run. Saying "free" is a fact about this deployment.
    pricing: { model: "free" },
    chains: ["robinhood"],
    toolNames: preset.manifest.tools.flightpath,
    verified: false,
    version: "0.1.0",
    source: "published",
    createdAt: CREATED_AT,
  };
}

function listingFromNest(preset: (typeof NEST_PRESETS)[number]): AviaryListing {
  const members = preset.finches.map((finch) => finch.manifest.identity.handle);
  return {
    slug: preset.identity.id,
    name: preset.identity.name,
    category: "agents",
    description: preset.identity.description,
    creator: { name: "Finch" },
    stats: { calls30d: 0, uptime90d: null },
    pricing: { model: "free" },
    chains: ["robinhood"],
    // A nest's "tools" are the finches it coordinates.
    toolNames: members,
    verified: false,
    version: "0.1.0",
    source: "published",
    createdAt: CREATED_AT,
  };
}

/** Individual finches that this deployment can hatch and run right now. */
export const REGISTRY_FINCHES: AviaryListing[] = SCHOOL_PRESETS.map(listingFromFinch);

/** Coordinated nests that this deployment can run right now. */
export const REGISTRY_NESTS: AviaryListing[] = NEST_PRESETS.map(listingFromNest);

/** Everything in the registry — finches and nests together. */
export const REGISTRY_LISTINGS: AviaryListing[] = [...REGISTRY_FINCHES, ...REGISTRY_NESTS];

export function getRegistryListing(slug: string): AviaryListing | undefined {
  return REGISTRY_LISTINGS.find((entry) => entry.slug === slug);
}

/**
 * Fold real run history into the listing stats.
 *
 * `runs` is whatever the run store actually holds. A listing nobody has run
 * keeps calls30d: 0, because that is the true number.
 */
export function withRunCounts(
  listings: AviaryListing[],
  runs: Array<{ subject: string; finishedAt: string }>,
): AviaryListing[] {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  for (const run of runs) {
    const at = new Date(run.finishedAt).getTime();
    if (!Number.isFinite(at) || at < cutoff) continue;
    counts.set(run.subject, (counts.get(run.subject) ?? 0) + 1);
  }
  return listings.map((listing) => ({
    ...listing,
    stats: { ...listing.stats, calls30d: counts.get(listing.slug) ?? 0 },
  }));
}
