import { FLIGHTPATH_TOOLS, getRegistryConfig, readRegistryRecord, registryId } from "@finch/flightpath";
import { getCollections, isDbConfigured } from "@finch/db";
import { REGISTRY_LISTINGS, REGISTRY_NESTS, getRegistryListing, withRunCounts } from "@/lib/registry";
import { errorJson, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/aviary/[slug] — one listing, with the capability profile resolved
 * from the Flightpath tool catalog so permissions are shown as facts rather
 * than as marketing claims.
 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) return errorJson(400, "invalid slug");

  let listing = REGISTRY_LISTINGS.find((entry) => entry.slug === slug) ?? null;
  let source: "db" | "builtin" = "builtin";

  if (isDbConfigured()) {
    try {
      const { aviaryListings } = await getCollections();
      const found = await aviaryListings.findOne({ slug }, { projection: { _id: 0 } });
      if (found) {
        listing = found;
        source = "db";
      }
    } catch {
      // fall back to the seed row, still labeled
    }
  }

  if (!listing) return errorJson(404, `no listing "${slug}"`);

  // Resolve declared tools against the real catalog — an unknown tool name is
  // reported as unknown rather than silently rendered as a capability.
  const capabilities = listing.toolNames.map((name) => {
    const tool = FLIGHTPATH_TOOLS.find((entry) => entry.name === name);
    return tool
      ? { name: tool.name, mode: tool.mode, category: tool.category, risk: tool.risk, description: tool.description, known: true }
      : { name, mode: "read" as const, category: "unknown", risk: "none" as const, description: "Not present in the Flightpath catalog.", known: false };
  });

  const requiresWrites = capabilities.some((capability) => capability.mode === "write");

  // Real onchain status — never an assumption. Until a registry authority is
  // configured this says so; once it is, an unanchored listing is reported
  // as exactly that. Nests and finches live in separate namespaces.
  const kind = REGISTRY_NESTS.some((entry) => entry.slug === listing!.slug) ? "NEST" : "FINCH";
  const registryConfig = getRegistryConfig();
  const id = registryId(kind, listing.slug);
  const record = registryConfig.configured ? await readRegistryRecord(kind, listing.slug) : null;
  const registry = !registryConfig.configured
    ? {
        onchain: false,
        id,
        note: "No registry authority is configured, so nothing here is anchored on Solana. An anchor is a memo transaction signed by the registry authority carrying the manifest's hash — that is what will make a listing independently checkable.",
      }
    : record
      ? {
          onchain: true,
          id,
          authority: registryConfig.authority,
          signature: record.signature,
          manifestHash: record.manifestHash,
          version: record.version,
          explorerUrl: registryConfig.explorerUrl,
          note: "Anchored: a memo signed by the registry authority binds this id to a manifest hash on Solana — checkable without trusting this index.",
        }
      : {
          onchain: false,
          id,
          authority: registryConfig.authority,
          explorerUrl: registryConfig.explorerUrl,
          note: "Not anchored: the registry authority has signed no memo for this id.",
        };

  return json({
    source,
    listing,
    capabilities,
    permissions: {
      requiresWrites,
      walletMode: requiresWrites ? "operator" : "observer",
      note: requiresWrites
        ? "Declares write-mode tools: an operator wallet with explicit allowances is required, and every write is simulated and policy-checked."
        : "Read-only: runs in observer mode with no wallet and no ability to transact.",
    },
    registry,
  });
}
