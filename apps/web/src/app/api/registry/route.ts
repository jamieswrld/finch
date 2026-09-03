import { getFlightpathTarget, getRegistryConfig, isRegistered, registryId } from "@finch/flightpath";
import { REGISTRY_FINCHES, REGISTRY_NESTS } from "@/lib/registry";
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

  // The registry id is namespaced by kind — keccak("finch:handle") is a
  // different id from keccak("nest:handle"), which is the whole point of the
  // namespace. Checking every listing as a FINCH reported all four nests as
  // unregistered while they were registered under their own ids.
  const subjects = [
    ...REGISTRY_FINCHES.map((listing) => ({ kind: "FINCH" as const, slug: listing.slug })),
    ...REGISTRY_NESTS.map((listing) => ({ kind: "NEST" as const, slug: listing.slug })),
  ];

  const checks = await Promise.all(
    subjects.slice(0, 24).map(async (subject) => {
      const id = registryId(subject.kind, subject.slug);
      return {
        slug: subject.slug,
        kind: subject.kind.toLowerCase(),
        id,
        registered: await isRegistered(id, target),
      };
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
