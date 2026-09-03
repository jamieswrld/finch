import { getFlightpathTarget, getRegistryConfig, isRegistered, registryId } from "@finch/flightpath";
import { REGISTRY_LISTINGS, getRegistryListing, withRunCounts } from "@/lib/registry";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/registry — onchain registration status.
 *
 * Reports what FinchRegistry actually holds. Until FINCH_REGISTRY_ADDRESS is
 * set the answer is "not deployed", and every listing is reported as
 * unregistered rather than being quietly presented as verified.
 */
export async function GET(): Promise<Response> {
  const target = getFlightpathTarget();
  const config = getRegistryConfig(target);

  if (!config.configured) {
    return json({
      configured: false,
      chainId: target.chain.id,
      note: "FinchRegistry is not deployed yet. Set FINCH_REGISTRY_ADDRESS once it is, and these records become independently verifiable from chain state alone.",
      registrations: [],
    });
  }

  // Check the seeded handles against the chain. Anything not registered says so.
  const checks = await Promise.all(
    REGISTRY_LISTINGS.slice(0, 24).map(async (listing) => {
      const id = registryId("FINCH", listing.slug);
      return { slug: listing.slug, id, registered: await isRegistered(id, target) };
    }),
  );

  return json({
    configured: true,
    chainId: target.chain.id,
    address: config.address,
    explorerUrl: config.explorerUrl,
    registrations: checks,
    registeredCount: checks.filter((check) => check.registered).length,
  });
}
