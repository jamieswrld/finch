import { FLIGHTPATH_TOOLS, getRegistryConfig, isRegistered, registryId } from "@finch/flightpath";
import { getCollections, isDbConfigured } from "@finch/db";
import { seedAviaryListings } from "@finch/db/seeds";
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

  let listing = seedAviaryListings.find((entry) => entry.slug === slug) ?? null;
  let source: "db" | "seed" = "seed";

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

  // Real onchain status — never an assumption. Until the registry is deployed
  // this says so; once it is, an unregistered listing is reported unregistered.
  const registryConfig = getRegistryConfig();
  const id = registryId("FINCH", listing.slug);
  const registry = registryConfig.configured
    ? {
        onchain: await isRegistered(id),
        id,
        contract: registryConfig.address,
        explorerUrl: registryConfig.explorerUrl,
        note: "Registration binds an id, owner, manifest hash, URI and version to chain 4663 — checkable without trusting this index.",
      }
    : {
        onchain: false,
        id,
        note: "FinchRegistry is not deployed on Robinhood Chain yet, so nothing here is onchain-verifiable. Registration (id, owner, manifest hash, URI, version) is what will make it so.",
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
