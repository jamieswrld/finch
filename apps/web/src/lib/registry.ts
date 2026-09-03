import { getCollections, isDbConfigured, type AviaryListing, type FinchDoc, type NestDoc } from "@finch/db";
import { nestManifestSchema, type NestManifest } from "@finch/sdk";
import { z } from "zod";
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

/**
 * Document-shaped builtins.
 *
 * /api/finches and /api/nests return DOCUMENTS (what the composer and builder
 * edit), not Aviary listings (what the browser cards render). Serving the
 * listing shape from a document endpoint produces objects whose fields the
 * consumer silently reads as undefined, so the two shapes are built
 * separately and deliberately.
 */

/** Builtin finches as FinchDoc rows — same shape a published finch has. */
export const REGISTRY_FINCH_DOCS: FinchDoc[] = SCHOOL_PRESETS.map((preset) => ({
  handle: preset.slug,
  manifest: preset.manifest as unknown as Record<string, unknown>,
  // These are hatched and runnable right now, not drafts.
  status: "hatched",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}));

/**
 * Builtin nests as NestDoc rows.
 *
 * A NestManifest carries a task DAG; a NestDoc carries stages and edges. Depth
 * in the dependency graph becomes the stage index, so tasks that can run
 * together sit in the same stage — which is exactly how the runtime schedules
 * them, rather than a layout invented for display.
 */
export const REGISTRY_NEST_DOCS: NestDoc[] = NEST_PRESETS.map((preset) => {
  const byId = new Map(preset.tasks.map((task) => [task.id, task]));

  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0; // validated elsewhere; never loop here
    seen.add(id);
    const task = byId.get(id);
    if (!task || task.dependsOn.length === 0) return 0;
    return 1 + Math.max(...task.dependsOn.map((dep) => depthOf(dep, seen)));
  };

  const stageCount = Math.max(1, ...preset.tasks.map((task) => depthOf(task.id) + 1));
  const stages = Array.from({ length: stageCount }, (_, index) => ({
    id: `stage-${index + 1}`,
    name: `Stage ${index + 1}`,
    finches: preset.tasks
      .filter((task) => depthOf(task.id) === index)
      .map((task) => {
        const member = preset.finches.find((entry) => entry.handle === task.finch);
        return {
          handle: task.finch,
          name: member?.name ?? task.finch,
          role: task.title,
          inputs: task.dependsOn.map((dep) => byId.get(dep)?.outputChannel ?? dep),
          outputs: [task.outputChannel],
          permissions: member?.manifest.tools.flightpath ?? [],
        };
      }),
  }));

  const edges = preset.tasks.flatMap((task) =>
    task.dependsOn.map((dep) => ({
      from: byId.get(dep)?.finch ?? dep,
      to: task.finch,
      channel: byId.get(dep)?.outputChannel ?? dep,
    })),
  );

  return {
    slug: preset.identity.id,
    name: preset.identity.name,
    description: preset.identity.description,
    stages,
    edges,
    status: "active" as const,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
});

/** Builtins first, then stored rows, with stored rows winning on a slug clash. */
export function mergeWithBuiltins<T extends { slug?: string; handle?: string }>(
  builtins: T[],
  stored: T[],
): T[] {
  const keyOf = (row: T) => row.slug ?? row.handle ?? "";
  const storedKeys = new Set(stored.map(keyOf));
  return [...builtins.filter((row) => !storedKeys.has(keyOf(row))), ...stored];
}


// ── Composition: nests built from other people's finches ───────────────────

/**
 * A nest member may be a REFERENCE to a registry finch instead of an
 * embedded manifest. This is what lets a nest be composed from finches other
 * people published: name the handle, and the registry supplies the document.
 *
 * The SDK's schema requires every member to carry a manifest, and runNest is
 * never handed a reference. Hydration happens here, before the strict parse,
 * so the runtime keeps one invariant and the network gets composition.
 */
export const nestMemberRefSchema = z.object({
  handle: z.string().min(1).max(64),
  ref: z.literal("registry"),
  name: z.string().min(1).max(80).optional(),
  role: z.string().max(200).optional(),
});

/** nest.manifest/0.1 with members that may be registry references. */
export const nestInputSchema = nestManifestSchema.extend({
  finches: z.array(z.union([nestManifestSchema.shape.finches.element, nestMemberRefSchema])).min(1).max(24),
});
export type NestInput = z.infer<typeof nestInputSchema>;

export class UnresolvedFinchError extends Error {
  constructor(public readonly handles: string[]) {
    super(`unknown finch handle${handles.length === 1 ? "" : "s"}: ${handles.join(", ")}`);
    this.name = "UnresolvedFinchError";
  }
}

/** Find a finch document by handle: builtins first, then the database. */
async function lookupFinch(handle: string): Promise<FinchDoc | null> {
  const builtin = REGISTRY_FINCH_DOCS.find((doc) => doc.handle === handle);
  if (builtin) return builtin;
  if (!isDbConfigured()) return null;
  try {
    const { finches } = await getCollections();
    return await finches.findOne({ handle }, { projection: { _id: 0 } });
  } catch {
    return null;
  }
}

/**
 * Replace every registry reference with the finch it names, then return a
 * manifest the SDK's strict schema accepts. An unknown handle is an error
 * naming the handle — never a silently dropped member.
 */
export async function hydrateNestMembers(input: NestInput): Promise<NestManifest> {
  const missing: string[] = [];
  const finches = await Promise.all(
    input.finches.map(async (member) => {
      if (!("ref" in member)) return member;
      const doc = await lookupFinch(member.handle);
      if (!doc) {
        missing.push(member.handle);
        return null;
      }
      const manifest = doc.manifest as { identity?: { name?: string; description?: string } };
      return {
        handle: member.handle,
        name: member.name ?? manifest.identity?.name ?? member.handle,
        role: member.role ?? manifest.identity?.description ?? "",
        manifest: doc.manifest,
      };
    }),
  );
  if (missing.length > 0) throw new UnresolvedFinchError(missing);
  return nestManifestSchema.parse({ ...input, finches: finches.filter(Boolean) });
}
