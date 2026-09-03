import { aviaryCategorySchema, aviaryListingSchema, getCollections, isDbConfigured } from "@finch/db";
import { REGISTRY_LISTINGS, withRunCounts } from "@/lib/registry";
import { listRuns } from "@finch/db";
import { errorJson, json, rateLimit, readJsonBody, safeErrorMessage } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** GET /api/aviary?category=&q= — registry listings from MongoDB, or seed fallback. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const categoryParam = url.searchParams.get("category");
  const q = url.searchParams.get("q")?.slice(0, 80) ?? "";

  const category = categoryParam ? aviaryCategorySchema.safeParse(categoryParam) : null;
  if (category && !category.success) {
    return errorJson(400, "unknown category");
  }

  if (isDbConfigured()) {
    try {
      const { aviaryListings } = await getCollections();
      const filter: Record<string, unknown> = {};
      if (category?.success) filter.category = category.data;
      if (q) filter.$or = [
        { name: { $regex: escapeRegex(q), $options: "i" } },
        { description: { $regex: escapeRegex(q), $options: "i" } },
      ];
      const listings = await aviaryListings
        .find(filter, { projection: { _id: 0 } })
        .sort({ "stats.calls30d": -1 })
        .limit(100)
        .toArray();
      return json({ source: "db", listings });
    } catch (error) {
      // Database configured but unreachable — surface the degraded state honestly.
      return json(
        {
          source: "builtin",
          degraded: true,
          note: `registry database unreachable (${safeErrorMessage(error, 120)}); serving seed data`,
          listings: await filterRegistry(category?.success ? category.data : null, q),
        },
        { status: 200 },
      );
    }
  }

  return json({ source: "builtin", listings: await filterRegistry(category?.success ? category.data : null, q) });
}

/**
 * Filter the builtin registry, with call counts folded in from REAL run
 * history. A listing nobody has run reports 0, because that is the number.
 */
async function filterRegistry(category: string | null, q: string) {
  const history = await listRuns(100);
  const needle = q.toLowerCase();
  return withRunCounts(REGISTRY_LISTINGS, history.runs)
    .filter((listing) => !category || listing.category === category)
    .filter(
      (listing) =>
        !needle ||
        listing.name.toLowerCase().includes(needle) ||
        listing.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => b.stats.calls30d - a.stats.calls30d);
}

/** POST /api/aviary — publish a listing draft (registry write requires the database). */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, 4);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = aviaryListingSchema
    .omit({ createdAt: true, source: true, stats: true, verified: true })
    .safeParse(body.body);
  if (!parsed.success) {
    return errorJson(422, "invalid listing", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  if (!isDbConfigured()) {
    return errorJson(503, "registry database not configured — publishing is unavailable in this environment", {
      configured: false,
    });
  }

  try {
    const { aviaryListings } = await getCollections();
    const listing = {
      ...parsed.data,
      // No history yet — null means unmeasured, not perfect.
      stats: { calls30d: 0, uptime90d: null },
      verified: false,
      source: "published" as const,
      createdAt: new Date().toISOString(),
    };
    const existing = await aviaryListings.findOne({ slug: listing.slug });
    // Publishing is create-only: a slug is never silently reassigned.
    if (existing) return errorJson(409, `slug "${listing.slug}" is already taken`);
    await aviaryListings.insertOne(listing);
    return json({ published: true, slug: listing.slug }, { status: 201 });
  } catch (error) {
    return errorJson(502, `registry write failed: ${safeErrorMessage(error, 160)}`);
  }
}
