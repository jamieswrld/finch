import { getCollections, isDbConfigured } from "@finch/db";
import { REGISTRY_FINCHES, REGISTRY_NESTS } from "@/lib/registry";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/network — honest network metrics.
 *
 * Rule from the spec: never invent numbers. These are actual counts of what
 * the registry currently holds (labeled seed pre-launch, live from MongoDB /
 * the onchain registry after). If the protocol contains 8 finches, show 8.
 */
export async function GET(): Promise<Response> {
  if (isDbConfigured()) {
    try {
      const collections = await getCollections();
      const [finches, nests, executions, proofs] = await Promise.all([
        collections.aviaryListings.countDocuments({}),
        collections.nests.countDocuments({}),
        collections.executions.countDocuments({}),
        // A proof of flight exists for exactly the confirmed executions.
        collections.executions.countDocuments({ state: "confirmed" }),
      ]);
      return json({
        source: "db",
        counts: {
          // Builtins are always available on top of whatever is registered.
          finches: REGISTRY_FINCHES.length + finches,
          nests: REGISTRY_NESTS.length + nests,
          executions,
          proofsOfFlight: proofs,
        },
        at: new Date().toISOString(),
      });
    } catch {
      // fall through to the builtin counts
    }
  }
  return json({
    source: "builtin",
    counts: {
      finches: REGISTRY_FINCHES.length,
      nests: REGISTRY_NESTS.length,
      executions: 0,
      proofsOfFlight: 0,
    },
    at: new Date().toISOString(),
  });
}
