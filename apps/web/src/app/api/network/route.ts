import { getCollections, isDbConfigured } from "@finch/db";
import { seedAviaryListings, seedNests } from "@finch/db/seeds";
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
      const [finches, nests, executions, proofs, seededFinches] = await Promise.all([
        collections.aviaryListings.countDocuments({}),
        collections.nests.countDocuments({}),
        collections.executions.countDocuments({}),
        // A proof of flight exists for exactly the confirmed executions.
        collections.executions.countDocuments({ state: "confirmed" }),
        collections.aviaryListings.countDocuments({ source: "seed" }),
      ]);
      return json({
        // A database holding seeded rows is still reporting seed data. Saying
        // "db" here would dress sample rows as live registrations.
        source: seededFinches > 0 ? "seed" : "db",
        seededRows: seededFinches,
        counts: { finches, nests, executions, proofsOfFlight: proofs },
        at: new Date().toISOString(),
      });
    } catch {
      // fall through to seed counts, labeled
    }
  }
  return json({
    source: "seed",
    counts: {
      finches: seedAviaryListings.length,
      nests: seedNests.length,
      executions: 0,
      proofsOfFlight: 0,
    },
    at: new Date().toISOString(),
  });
}
