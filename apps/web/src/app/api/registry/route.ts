import { getFlightpathTarget, getRegistryConfig, indexRegistrations, registryId } from "@finch/flightpath";
import { REGISTRY_FINCHES, REGISTRY_NESTS } from "@/lib/registry";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/registry — what is anchored on Solana.
 *
 * The registry is the authority's signed memo history (see registry.ts in
 * @finch/flightpath). Until FINCH_REGISTRY_AUTHORITY is set the answer is
 * "not configured", and every listing is reported as unanchored rather than
 * being quietly presented as verified.
 */
export async function GET(): Promise<Response> {
  const target = getFlightpathTarget();
  const config = getRegistryConfig(target);

  if (!config.configured) {
    return json({
      configured: false,
      chain: target.chain,
      authority: null,
      note: "No registry authority is configured. Set FINCH_REGISTRY_AUTHORITY, anchor listings with scripts/registry-anchor.mjs, and these records become independently verifiable from Solana alone.",
      registrations: [],
      registeredCount: 0,
    });
  }

  // Ids are namespaced by kind — "finch:x" and "nest:x" are different ids —
  // so each listing is checked under its own kind.
  const index = await indexRegistrations(target);
  const subjects = [
    ...REGISTRY_FINCHES.map((listing) => ({ kind: "FINCH" as const, slug: listing.slug })),
    ...REGISTRY_NESTS.map((listing) => ({ kind: "NEST" as const, slug: listing.slug })),
  ];
  const registrations = subjects.map((subject) => {
    const id = registryId(subject.kind, subject.slug);
    // Signature history is newest first: the first anchor is the current one.
    const latest = index.events.find((event) => event.id === id);
    return {
      slug: subject.slug,
      kind: subject.kind.toLowerCase(),
      id,
      registered: Boolean(latest),
      ...(latest ? { signature: latest.signature, manifestHash: latest.manifestHash } : {}),
    };
  });

  return json({
    configured: true,
    chain: target.chain,
    authority: config.authority,
    explorerUrl: config.explorerUrl,
    registrations,
    registeredCount: registrations.filter((entry) => entry.registered).length,
    ...(index.error ? { note: `the registry could not be read: ${index.error}` } : {}),
  });
}
