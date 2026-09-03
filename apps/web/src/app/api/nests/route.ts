import { nestDocSchema, getCollections, isDbConfigured } from "@finch/db";
import { seedNests } from "@finch/db/seeds";
import { errorJson, json, rateLimit, readJsonBody, safeErrorMessage } from "@/lib/server/http";
import { canWrite, resolveIdentity } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/nests — stored nests, or the seed reference nest. */
export async function GET(): Promise<Response> {
  if (isDbConfigured()) {
    try {
      const { nests } = await getCollections();
      const rows = await nests.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(50).toArray();
      // An empty collection means we are serving seed rows — say so, rather
      // than stamping demo data with a "registry" badge.
      if (rows.length > 0) return json({ source: "db", nests: rows });
      return json({ source: "seed", nests: seedNests });
    } catch (error) {
      return json({
        source: "seed",
        degraded: true,
        note: `database unreachable (${safeErrorMessage(error, 120)})`,
        nests: seedNests,
      });
    }
  }
  return json({ source: "seed", nests: seedNests });
}

/** POST /api/nests — save a nest draft. Persists structure only; never claims execution. */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, 4);
  if (limited) return limited;

  const identity = await resolveIdentity(request);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  // `owner` is stripped: it is assigned by the server from the caller's key,
  // never accepted from the body. Otherwise anyone could claim any handle.
  const parsed = nestDocSchema
    .omit({ createdAt: true, updatedAt: true, status: true, owner: true })
    .safeParse(body.body);
  if (!parsed.success) {
    return errorJson(422, "invalid nest", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  if (!isDbConfigured()) {
    return json({
      saved: false,
      reason: "db-not-configured",
      note: "No database in this environment — export the nest JSON instead.",
      nest: parsed.data,
    });
  }

  try {
    const { nests } = await getCollections();
    const now = new Date().toISOString();
    const existing = await nests.findOne({ slug: parsed.data.slug });
    const verdict = canWrite(identity, existing ? existing.owner ?? null : undefined);
    if (!verdict.ok) {
      return errorJson(verdict.status, verdict.reason, { slug: parsed.data.slug });
    }
    // Guard the write on the ownership state we just checked, so a concurrent
    // request cannot slip in between the check and the update.
    const guard: Record<string, unknown> = existing
      ? { slug: parsed.data.slug, owner: existing.owner ?? { $in: [null, undefined] } }
      : { slug: parsed.data.slug };
    const result = await nests.updateOne(
      guard as Parameters<typeof nests.updateOne>[0],
      {
        $set: { ...parsed.data, status: "draft", updatedAt: now },
        $setOnInsert: { createdAt: now, owner: identity.owner ?? undefined },
      },
      { upsert: !existing },
    );
    if (result.matchedCount === 0 && result.upsertedCount === 0) {
      return errorJson(409, "this nest changed while you were saving — reload and try again", { slug: parsed.data.slug });
    }
    return json({ saved: true, slug: parsed.data.slug, status: "draft" }, { status: 201 });
  } catch (error) {
    return errorJson(502, `nest save failed: ${safeErrorMessage(error, 160)}`);
  }
}
